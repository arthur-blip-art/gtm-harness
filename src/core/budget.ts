import { registry } from '../providers/index.ts';
import type { LegMeta, Receipt, ToolInput } from './types.ts';

/**
 * Spend control, in dollars. Credits differ by provider (a Serper credit is not an LLM credit),
 * so every cap is in USD, computed from each adapter's price table.
 *
 *   1. Before a call: the worst-case price of the call (every row billed) must fit in what is
 *      left of the cap. A waterfall leg that cannot afford all its rows runs only the rows it can
 *      afford, then the run stops. The cap is never overshot by more than estimate error.
 *   2. Probation: a paid leg that returns nothing on its first PROBE attempts is demoted for the
 *      rest of the run (its remaining rows go to the next leg).
 *   3. After a call: actual spend (from the receipt) is added; cached receipts cost nothing.
 */
export interface Spend { credits: number; usd: number }
export interface LegStat { attempts: number; hits: number; demoted: boolean }
export interface BudgetState {
  spent: Spend;
  maxUsd?: number;
  maxCredits?: number;
  legStats?: Map<string, LegStat>;
  log?: (m: string) => void;
}

export class BudgetExceeded extends Error {
  constructor(public spent: number, public cap: number, public unit: 'credits' | 'usd' = 'credits', why = '') {
    super(`Budget exceeded: ${unit === 'usd' ? `$${round(spent)}` : `${round(spent)} credits`} spent, cap ${unit === 'usd' ? `$${cap}` : cap}${why ? ` (${why})` : ''}`);
  }
}

/** Probe size before demotion; GTM_DEMOTE_AFTER=0 disables probation. */
export const PROBE = (() => { const v = Number(process.env.GTM_DEMOTE_AFTER ?? 5); return Number.isFinite(v) && v >= 0 ? v : 5; })();

/** Worst-case USD of one call: per_hit counts as a hit, per_result as the requested page size. */
export function unitUsd(provider: string, tool: string, input?: ToolInput): number {
  const a = registry[provider];
  const p = a?.pricing.table[tool];
  if (!a || !p) return 0;
  if (p.basis === 'free') return 0;
  const n = p.basis === 'per_result' ? Number(input?.limit ?? input?.per_page ?? input?.numResults ?? input?.page_size ?? 25) || 25 : 1;
  return p.credits * a.pricing.usdPerCredit * n;
}

export function charge(b: BudgetState, rc: Receipt): void {
  if (rc.cached) return;
  b.spent.credits += rc.costCredits;
  b.spent.usd += rc.costUsd ?? 0;
}

/** Throws once the run is past a cap (after the fact, for legacy credit caps). */
export function checkAfter(b: BudgetState): void {
  if (b.maxUsd !== undefined && b.spent.usd > b.maxUsd) throw new BudgetExceeded(b.spent.usd, b.maxUsd, 'usd');
  if (b.maxCredits !== undefined && b.spent.credits > b.maxCredits) throw new BudgetExceeded(b.spent.credits, b.maxCredits, 'credits');
}

/** How many calls at `unit` dollars still fit under the USD cap (Infinity when uncapped or free). */
export function affordable(b: BudgetState, unit: number): number {
  if (b.maxUsd === undefined || unit <= 0) return Infinity;
  return Math.max(0, Math.floor((b.maxUsd - b.spent.usd + 1e-9) / unit));
}

/** Throws before a single call that would not fit. */
export function checkBefore(b: BudgetState, provider: string, tool: string, input?: ToolInput): void {
  const unit = unitUsd(provider, tool, input);
  if (affordable(b, unit) < 1) throw new BudgetExceeded(b.spent.usd, b.maxUsd!, 'usd', `next call ${provider}/${tool} would cost up to $${round(unit)}`);
}

const statKey = (leg: string, provider: string, tool: string) => `${leg.split(':')[0]}|${provider}|${tool}`;

/** True when this paid leg already failed its probation in this run. */
export function isDemoted(b: BudgetState, leg: string, provider: string, tool: string): boolean {
  return !!b.legStats?.get(statKey(leg, provider, tool))?.demoted;
}

/** Record attempts and hits; demote a paid leg after PROBE attempts with no hit. Returns true if it just got demoted. */
export function recordOutcome(b: BudgetState, leg: string, provider: string, tool: string, attempts: number, hits: number, meta?: LegMeta): boolean {
  if (!b.legStats || PROBE === 0 || unitUsd(provider, tool) === 0) return false;
  const k = statKey(leg, provider, tool);
  const s = b.legStats.get(k) ?? { attempts: 0, hits: 0, demoted: false };
  s.attempts += attempts;
  s.hits += hits;
  b.legStats.set(k, s);
  if (!s.demoted && s.hits === 0 && s.attempts >= PROBE) {
    s.demoted = true;
    if (meta) meta.demoted = true;
    b.log?.(`demoted ${provider}/${tool} (${leg.split(':')[0]}): 0 hits on its first ${s.attempts} attempts, skipped for the rest of the run`);
    return true;
  }
  return false;
}

const round = (n: number) => Math.round(n * 10000) / 10000;
