import type { PlayCtx } from './play.ts';
import type { LegMeta, Receipt } from './types.ts';
import { charge, checkAfter, checkBefore, isDemoted, recordOutcome } from './budget.ts';
import { legEnabled } from '../plays/name-domain-to-email.ts';

/**
 * One provider call outside a row waterfall: records the leg in the receipt, checks the USD cap
 * against the call's worst-case price before spending, counts actual spend, applies probation.
 * Returns null when the leg is disabled (no key, filtered by --legs) or demoted in this run.
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
  const b = budgetOf(ctx);
  if (isDemoted(b, id, provider, tool)) { meta.demoted = true; return null; }
  checkBefore(b, provider, tool, input);
  meta.rowsReached = 1;
  const rc = await ctx.runner.execute({ provider, tool, input, runId: ctx.runId });
  meta.receiptIds!.push(rc.id);
  charge(b, rc);
  if (rc.status === 'hit') meta.accepted = 1;
  if (rc.status !== 'error') recordOutcome(b, id, provider, tool, 1, rc.status === 'hit' ? 1 : 0, meta);
  checkAfter(b);
  return Object.assign(rc, { meta });
}

/** The run's budget view of a play context. */
export const budgetOf = (ctx: PlayCtx) => ({ spent: ctx.spent, maxUsd: ctx.maxUsd, maxCredits: ctx.maxCredits, legStats: ctx.legStats, log: ctx.log });

/** True when the provider can run (dry-run, or its key is configured). */
export const canRun = (ctx: Pick<PlayCtx, 'dryRun' | 'legs'>, provider: string, id = provider) => legEnabled(ctx, provider, id);
