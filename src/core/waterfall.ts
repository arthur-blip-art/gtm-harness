import type { EmailCandidate, LegCell, Receipt, RowState, ToolInput } from './types.ts';
import { canonicalStatus, checkDomain, decide, isAccepted } from './email-policy.ts';
import type { ToolRunner } from './tools.ts';
import type { LegMeta } from './receipt.ts';
import { normalizeEmail } from './normalize.ts';

export interface Leg {
  /** Column suffix: cells[`email_result__${id}`]. */
  id: string;
  provider: string;
  tool: string;
  /** False when the key is missing: leg recorded as `skipped` on every row. */
  enabled: boolean;
  /** Null → this row cannot use this leg (e.g. missing linkedin_url). */
  buildInput(row: RowState): ToolInput | null;
  /** Pull candidate(s) out of a hit. */
  extract(receipt: Receipt, row: RowState): Array<{ email: string; rawStatus?: string }>;
}

export interface WaterfallOpts {
  runId: string;
  maxCredits?: number;
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
 * accepted email, and so on. Per-row semantics equal Deepline's row-sequential waterfall
 * (a row never reaches leg N+1 once leg N was accepted); leg-major lets batch providers batch.
 */
export async function runWaterfall(rows: RowState[], legs: Leg[], runner: ToolRunner, opts: WaterfallOpts): Promise<LegMeta[]> {
  const log = opts.log ?? (() => {});
  const metas: LegMeta[] = [];
  let spent = 0;
  let legsTried = 0;

  for (const leg of legs) {
    const col = `email_result__${leg.id}`;
    const pending = rows.filter((r) => !r.candidates.some(isAccepted));
    const meta: LegMeta = { leg: leg.id, provider: leg.provider, tool: leg.tool, rowsReached: 0, accepted: 0 };

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
        if (!rc.cached) spent += rc.costCredits;
        row.cells[col] = toCell(rc, leg, row, meta);
        await opts.onRowUpdated?.(row);
      }
    }
    metas.push(meta);
    await opts.onLegDone?.(leg, meta);

    if (opts.maxCredits !== undefined && spent > opts.maxCredits) {
      finalize(rows, legs, legsTried, col);
      throw new BudgetExceeded(spent, opts.maxCredits);
    }
  }

  finalize(rows, legs, legsTried);
  return metas;
}

function toCell(rc: Receipt & { missReason?: string }, leg: Leg, row: RowState, meta: LegMeta): LegCell {
  const base = { receiptId: rc.id, cached: rc.cached ?? false, costCredits: rc.cached ? 0 : rc.costCredits };
  if (rc.status === 'error') return cellOf('error', { ...base, missReason: `leg_error:${rc.error ?? 'unknown'}` });
  if (rc.status === 'miss') return cellOf('miss', { ...base, missReason: rc.missReason ?? 'no_match' });

  const found = leg.extract(rc, row);
  let first: LegCell | null = null;
  for (const f of found) {
    const email = normalizeEmail(f.email);
    if (!email) continue;
    const dom = checkDomain(email, row.input.domain);
    if (!dom.ok) {
      first ??= cellOf('miss', { ...base, value: email, rawStatus: f.rawStatus, missReason: dom.reason });
      continue;
    }
    const cand: EmailCandidate = { email, rawStatus: f.rawStatus, status: canonicalStatus(leg.provider, f.rawStatus), source: leg.id };
    row.candidates.push(cand);
    if (isAccepted(cand)) meta.accepted++;
    const c = cellOf('hit', { ...base, value: email, rawStatus: f.rawStatus ?? cand.status });
    if (!first || first.status !== 'hit') first = c;
  }
  return first ?? cellOf('miss', { ...base, missReason: 'empty_hit' });
}

function finalize(rows: RowState[], legs: Leg[], legsTried: number, abortedAt?: string) {
  for (const r of rows) {
    for (const leg of legs) {
      const col = `email_result__${leg.id}`;
      if (!(col in r.cells)) r.cells[col] = cellOf('not_reached', { missReason: abortedAt ? 'budget_abort' : undefined });
    }
    r.cells.email = decide(r.candidates, legsTried);
  }
}

function cellOf(status: LegCell['status'], extra: Partial<LegCell> = {}): LegCell {
  return { status, costCredits: 0, at: new Date().toISOString(), ...extra };
}
