import type { PlayCtx } from './play.ts';
import type { LegMeta, Receipt } from './types.ts';
import { BudgetExceeded } from './waterfall.ts';
import { legEnabled } from '../plays/name-domain-to-email.ts';

/**
 * One provider call outside a row waterfall: records the leg in the receipt, counts spend,
 * enforces the run cap. Returns null when the leg is disabled (no key, or filtered by --legs).
 * `accept` lets the caller say how many useful items the call produced (for the receipt).
 */
export async function callLeg(
  ctx: PlayCtx,
  id: string,
  provider: string,
  tool: string,
  input: Record<string, unknown>,
): Promise<(Receipt & { meta: LegMeta }) | null> {
  const meta: LegMeta = { leg: id, provider, tool, rowsReached: 0, accepted: 0, receiptIds: [] };
  ctx.metas.push(meta);
  if (!legEnabled(ctx, provider, id.split(':')[0])) return null;
  meta.rowsReached = 1;
  const rc = await ctx.runner.execute({ provider, tool, input, runId: ctx.runId });
  meta.receiptIds!.push(rc.id);
  if (!rc.cached) ctx.spent.credits += rc.costCredits;
  if (ctx.maxCredits !== undefined && ctx.spent.credits > ctx.maxCredits) throw new BudgetExceeded(ctx.spent.credits, ctx.maxCredits);
  if (rc.status === 'hit') meta.accepted = 1;
  return Object.assign(rc, { meta });
}

/** True when the provider can run (dry-run, or its key is configured). */
export const canRun = (ctx: Pick<PlayCtx, 'dryRun' | 'legs'>, provider: string, id = provider) => legEnabled(ctx, provider, id);
