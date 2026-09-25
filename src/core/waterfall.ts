import type { Candidate, FieldCell, LegCell, LegMeta, Receipt, RowState, ToolInput } from './types.ts';
import type { ToolRunner } from './tools.ts';

/** Everything the waterfall needs to know about one target field. Pure, testable. */
export interface FieldPolicy<S extends string = string> {
  field: string;
  normalize(v: string): string | null;
  canonicalStatus(provider: string, raw: unknown, extra?: Record<string, unknown>): S;
  gate(value: string, row: RowState, extra?: Record<string, unknown>): { ok: true } | { ok: false; reason: string };
  isAccepted(c: Candidate<S>): boolean;
  decide(candidates: Candidate<S>[], legsTried: number): FieldCell<S>;
}

export interface Extracted {
  value: string;
  rawStatus?: string;
  extra?: Record<string, unknown>;
}

export interface Leg {
  /** Column suffix: cells[`${field}_result__${id}`]. */
  id: string;
  provider: string;
  tool: string;
  /** False when the key is missing: leg recorded as `skipped` on every row. */
  enabled: boolean;
  /** Null → this row cannot use this leg (e.g. missing linkedin_url). */
  buildInput(row: RowState): ToolInput | null;
  /** Pull candidate(s) out of a hit. */
  extract(receipt: Receipt, row: RowState): Extracted[];
}

export interface WaterfallOpts {
  runId: string;
  policy: FieldPolicy<any>;
  maxCredits?: number;
  /** Shared spend counter for the whole run (composition): mutated in place. */
  spent?: { credits: number };
  log?: (msg: string) => void;
  onLegDone?: (leg: Leg, meta: LegMeta) => Promise<void> | void;
  onRowUpdated?: (row: RowState) => Promise<void> | void;
}

export class BudgetExceeded extends Error {
  constructor(public spent: number, public cap: number) {
    super(`Budget exceeded: ${spent} credits spent, cap ${cap}`);
  }
}

/**
 * Leg-major waterfall: leg 1 over every pending row, then leg 2 over rows still without an
 * accepted value, and so on. Per-row semantics equal a row-sequential waterfall
 * (a row never reaches leg N+1 once leg N was accepted); leg-major lets batch providers batch.
 */
export async function runWaterfall(rows: RowState[], legs: Leg[], runner: ToolRunner, opts: WaterfallOpts): Promise<LegMeta[]> {
  const log = opts.log ?? (() => {});
  const policy = opts.policy;
  const field = policy.field;
  const metas: LegMeta[] = [];
  const spent = opts.spent ?? { credits: 0 };
  let legsTried = 0;
  const cands = (r: RowState) => (r.candidates[field] ??= []);
  const accepted = (r: RowState) => cands(r).some((c) => policy.isAccepted(c));

  for (const leg of legs) {
    const col = `${field}_result__${leg.id}`;
    const pending = rows.filter((r) => !accepted(r));
    const meta: LegMeta = { leg: leg.id, provider: leg.provider, tool: leg.tool, rowsReached: 0, accepted: 0, receiptIds: [] };

    if (!leg.enabled) {
      for (const r of pending) r.cells[col] = cellOf('skipped', { missReason: 'leg_disabled' });
      metas.push(meta);
      await opts.onLegDone?.(leg, meta);
      continue;
    }
    legsTried++;

    const work: { row: RowState; input: ToolInput }[] = [];
    for (const r of pending) {
      const input = leg.buildInput(r);
      if (!input) r.cells[col] = cellOf('skipped', { missReason: 'missing_input' });
      else work.push({ row: r, input });
    }
    meta.rowsReached = work.length;
    log(`leg ${leg.id} (${leg.provider}/${leg.tool}): ${work.length} rows`);

    if (work.length > 0) {
      const receipts = await runner.executeBatch({
        provider: leg.provider, tool: leg.tool, inputs: work.map((w) => w.input), runId: opts.runId,
      });
      for (let i = 0; i < work.length; i++) {
        const { row } = work[i];
        const rc = receipts[i];
        if (!rc.cached) spent.credits += rc.costCredits;
        meta.receiptIds!.push(rc.id);
        row.cells[col] = toCell(rc, leg, row, meta, policy);
        await opts.onRowUpdated?.(row);
      }
    }
    metas.push(meta);
    await opts.onLegDone?.(leg, meta);

    if (opts.maxCredits !== undefined && spent.credits > opts.maxCredits) {
      finalize(rows, legs, legsTried, policy, true);
      throw new BudgetExceeded(spent.credits, opts.maxCredits);
    }
  }

  finalize(rows, legs, legsTried, policy, false);
  return metas;
}

function toCell(rc: Receipt & { missReason?: string }, leg: Leg, row: RowState, meta: LegMeta, policy: FieldPolicy): LegCell {
  const base = { receiptId: rc.id, cached: rc.cached ?? false, costCredits: rc.cached ? 0 : rc.costCredits };
  if (rc.status === 'error') return cellOf('error', { ...base, missReason: `leg_error:${rc.error ?? 'unknown'}` });
  if (rc.status === 'miss') return cellOf('miss', { ...base, missReason: rc.missReason ?? 'no_match' });

  const found = leg.extract(rc, row);
  let first: LegCell | null = null;
  for (const f of found) {
    const value = policy.normalize(f.value);
    if (!value) continue;
    const gate = policy.gate(value, row, f.extra);
    if (!gate.ok) {
      first ??= cellOf('miss', { ...base, value, rawStatus: f.rawStatus, missReason: gate.reason });
      continue;
    }
    const cand: Candidate = { value, rawStatus: f.rawStatus, status: policy.canonicalStatus(leg.provider, f.rawStatus, f.extra), source: leg.id, extra: f.extra };
    (row.candidates[policy.field] ??= []).push(cand);
    if (policy.isAccepted(cand)) meta.accepted++;
    const c = cellOf('hit', { ...base, value, rawStatus: f.rawStatus ?? cand.status });
    if (!first || first.status !== 'hit') first = c;
  }
  return first ?? cellOf('miss', { ...base, missReason: 'empty_hit' });
}

function finalize(rows: RowState[], legs: Leg[], legsTried: number, policy: FieldPolicy, aborted: boolean) {
  for (const r of rows) {
    for (const leg of legs) {
      const col = `${policy.field}_result__${leg.id}`;
      if (!(col in r.cells)) r.cells[col] = cellOf('not_reached', { missReason: aborted ? 'budget_abort' : undefined });
    }
    r.cells[policy.field] = policy.decide(r.candidates[policy.field] ?? [], legsTried);
  }
}

export function cellOf(status: LegCell['status'], extra: Partial<LegCell> = {}): LegCell {
  return { status, costCredits: 0, at: new Date().toISOString(), ...extra };
}
