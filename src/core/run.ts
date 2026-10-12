import type { Store } from '../store/store.ts';
import { registry } from '../providers/index.ts';
import { ToolRunner } from './tools.ts';
import { createCtx, type Play } from './play.ts';
import { buildReceipt, type CostReceipt } from './receipt.ts';
import { BudgetExceeded } from './waterfall.ts';
import type { Receipt, RunStatus } from './types.ts';

export interface ExecuteOpts {
  play: Play;
  input: unknown;
  store: Store;
  resolvePlay: (name: string) => Play;
  dryRun?: boolean;
  refresh?: boolean;
  legs?: string[];
  maxCredits?: number;
  /** USD cap for this run. */
  maxUsd?: number;
  /** Month-to-date USD budget; the run cap shrinks to what is left of it. Ignored in dry-run. */
  monthlyBudgetUsd?: number;
  log?: (msg: string) => void;
  inputSummary?: Record<string, unknown>;
}

export interface ExecuteResult<O = unknown> {
  runId: string;
  status: RunStatus;
  output?: O;
  receipt: CostReceipt;
  notes?: string;
  newReceipts: number;
  cachedReceipts: number;
}

/** createRun → root ctx → play.run → receipt over the whole tree → finishRun. */
export async function executePlay<O = unknown>(o: ExecuteOpts): Promise<ExecuteResult<O>> {
  const log = o.log ?? (() => {});
  const runner = new ToolRunner(o.store, registry, { dryRun: o.dryRun, refresh: o.refresh, log });
  const parsed = o.play.input.parse(o.input);
  const run = await o.store.createRun(o.play.name, { ...(o.inputSummary ?? {}), dryRun: !!o.dryRun, refresh: !!o.refresh, legs: o.legs ?? null, maxCredits: o.maxCredits ?? null, maxUsd: o.maxUsd ?? null, cwd: process.cwd() });
  // Monthly budget: the run may only spend what is left of it; at 80% say so, at 100% refuse.
  let maxUsd = o.maxUsd;
  if (!o.dryRun && o.monthlyBudgetUsd !== undefined) {
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const mtd = (await o.store.spendSince(monthStart)).usd;
    const left = Math.max(0, o.monthlyBudgetUsd - mtd);
    if (mtd >= 0.8 * o.monthlyBudgetUsd) log(`monthly budget: $${mtd.toFixed(2)} of $${o.monthlyBudgetUsd} spent this month (${Math.round((100 * mtd) / o.monthlyBudgetUsd)}%)`);
    if (left <= 0) {
      const notes = `Monthly budget reached: $${mtd.toFixed(2)} of $${o.monthlyBudgetUsd} spent this month. Raise GTM_MONTHLY_BUDGET_USD or wait for next month.`;
      log(notes);
      await o.store.finishRun(run.id, { status: 'aborted', rowsIn: 0, rowsOut: 0, totalCostCredits: 0, totalCostUsd: 0, notes });
      return { runId: run.id, status: 'aborted', receipt: buildReceipt(run.id, 0, [], []), notes, newReceipts: 0, cachedReceipts: 0 };
    }
    maxUsd = maxUsd === undefined ? left : Math.min(maxUsd, left);
  }
  const ctx = createCtx({ runId: run.id, playName: o.play.name, runner, store: o.store, log, dryRun: !!o.dryRun, refresh: o.refresh, legs: o.legs, maxCredits: o.maxCredits, maxUsd, resolvePlay: o.resolvePlay });
  log(`run ${run.id}  play=${o.play.name}  store=${o.store.kind}${maxUsd !== undefined ? `  cap=$${Math.round(maxUsd * 100) / 100}` : ''}${o.maxCredits !== undefined ? `  cap=${o.maxCredits} credits` : ''}`);

  let status: RunStatus = 'done';
  let notes: string | undefined;
  let output: O | undefined;
  try {
    output = (await o.play.run(parsed, ctx)) as O;
  } catch (e) {
    if (e instanceof BudgetExceeded) { status = 'aborted'; notes = e.message; log(e.message); }
    else { status = 'failed'; notes = e instanceof Error ? e.message : String(e); log(`FAILED: ${notes}`); }
  }
  // Receipts created by this run plus the cached ones its legs reused (attributed to the leg, never as spend).
  const own = await o.store.listReceiptsByRun(run.id);
  const wanted = new Set(ctx.metas.flatMap((m) => m.receiptIds ?? []));
  const ownIds = new Set(own.map((r) => r.id));
  const reused: Receipt[] = [];
  for (const id of wanted) if (!ownIds.has(id)) { const r = await o.store.getReceipt(id); if (r) reused.push({ ...r, cached: true }); }
  const receipts = [...own, ...reused];
  const rowsIn = rowsOf(output) ?? 1;
  const receipt = buildReceipt(run.id, rowsIn, receipts, ctx.metas);
  // cache hits = every reference a leg made minus the distinct receipts this run actually created
  const refs = ctx.metas.flatMap((m) => m.receiptIds ?? []);
  const cached = Math.max(0, refs.length - own.filter((r) => wanted.has(r.id)).length);
  await o.store.finishRun(run.id, { status, rowsIn, rowsOut: receipt.rowsAccepted, totalCostCredits: receipt.totalCredits, totalCostUsd: receipt.totalUsd, receipt, notes });
  return { runId: run.id, status, output, receipt, notes, newReceipts: receipts.length - cached, cachedReceipts: cached };
}

function rowsOf(output: unknown): number | undefined {
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    for (const k of ['rows', 'people', 'companies', 'signals', 'scores']) {
      if (Array.isArray(o[k])) return (o[k] as unknown[]).length;
      if (typeof o[k] === 'number') return o[k] as number;
    }
  }
  return undefined;
}
