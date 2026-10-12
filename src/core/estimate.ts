import { registry } from '../providers/index.ts';
import { MemoryStore } from '../store/memory.ts';
import { executePlay, type ExecuteOpts } from './run.ts';
import type { Receipt } from './types.ts';

/**
 * What a run will cost, before it runs. The play is replayed in dry-run (mock providers, no
 * spend, no database), which gives its real call structure: which legs are reached, how many
 * calls each makes. Each call is then priced with the REAL adapter's table, worst case:
 * per_hit counts as a hit, per_result as the page it asked for. Real runs cost less (misses
 * are free on per_hit, the cache serves repeats), never more unless the price table is wrong.
 */
export interface EstimateLine { provider: string; tool: string; calls: number; units: number; usd: number; basis: string }
export interface Estimate { worstUsd: number; freeCalls: number; paidCalls: number; lines: EstimateLine[]; status: string; notes?: string }

function units(r: Receipt, basis: string): number {
  if (basis === 'free') return 0;
  if (basis !== 'per_result') return 1;
  const asked = Number((r.input as any)?.limit ?? (r.input as any)?.per_page ?? (r.input as any)?.numResults ?? 0);
  if (asked > 0) return asked;
  const o = (r.output ?? {}) as Record<string, unknown>;
  const arr = Object.values(o).find(Array.isArray) as unknown[] | undefined;
  return Math.max(1, arr?.length ?? 1);
}

export async function estimateRun(o: Omit<ExecuteOpts, 'store' | 'dryRun'>): Promise<Estimate> {
  const store = new MemoryStore();
  const res = await executePlay({ ...o, store, dryRun: true, maxUsd: undefined, maxCredits: undefined, monthlyBudgetUsd: undefined });
  const byKey = new Map<string, EstimateLine>();
  let freeCalls = 0, paidCalls = 0;
  for (const r of store.receipts) {
    const a = registry[r.provider];
    const p = a?.pricing.table[r.tool];
    const basis = p?.basis ?? 'unknown';
    const u = units(r, basis);
    const usd = (p?.credits ?? 0) * (a?.pricing.usdPerCredit ?? 0) * u;
    if (usd === 0) freeCalls++; else paidCalls++;
    const k = `${r.provider}/${r.tool}`;
    const line = byKey.get(k) ?? { provider: r.provider, tool: r.tool, calls: 0, units: 0, usd: 0, basis };
    line.calls++; line.units += u; line.usd += usd;
    byKey.set(k, line);
  }
  const lines = [...byKey.values()].sort((x, y) => y.usd - x.usd);
  return { worstUsd: Math.round(lines.reduce((s, l) => s + l.usd, 0) * 100) / 100, freeCalls, paidCalls, lines, status: res.status, notes: res.notes };
}

export function renderEstimate(e: Estimate): string {
  const L = [
    `COST ESTIMATE (worst case: every call billed at the adapter's list price; no money spent)`,
    `paid calls: ${e.paidCalls}   free calls: ${e.freeCalls}   worst case: $${e.worstUsd.toFixed(2)}`,
    '',
    '| provider/tool | basis | calls | billable units | worst case $ |',
    '|---|---|---|---|---|',
    ...e.lines.filter((l) => l.usd > 0).map((l) => `| ${l.provider}/${l.tool} | ${l.basis} | ${l.calls} | ${l.units} | ${l.usd.toFixed(3)} |`),
    '',
    `Free legs (site, DNS, ATS boards, news, registries) are not listed. The call structure comes from a dry-run with simulated hit rates; with real data, later legs are reached less often when earlier ones succeed. Prices are estimates until checked on each provider's dashboard (\`gtm providers\`).`,
  ];
  return L.join('\n');
}
