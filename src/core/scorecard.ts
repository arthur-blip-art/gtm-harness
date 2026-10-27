import type { Receipt } from './types.ts';

export interface ScorecardRow {
  provider: string; tool: string; calls: number; hits: number; misses: number; errors: number;
  hit_rate: number | null; credits: number; credits_per_hit: number | null; median_ms: number | null; paid: boolean; recommendation: string;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Lifetime value of each provider/tool from stored receipts (each one is a real call; cache
 * hits create no receipt). Paid = the tool ever cost credits or is not priced as free.
 */
export function buildScorecard(receipts: Receipt[], opts: { minCalls?: number } = {}): ScorecardRow[] {
  const minCalls = opts.minCalls ?? 20;
  const groups = new Map<string, Receipt[]>();
  for (const r of receipts) {
    const k = `${r.provider}/${r.tool}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const rows = [...groups.values()].map((rs): ScorecardRow => {
    const hits = rs.filter((r) => r.status === 'hit').length;
    const misses = rs.filter((r) => r.status === 'miss').length;
    const errors = rs.filter((r) => r.status === 'error').length;
    const credits = rs.reduce((a, r) => a + (Number(r.costCredits) || 0), 0);
    const paid = credits > 0 || rs.some((r) => r.pricingBasis !== 'free');
    const calls = rs.length;
    const hitRate = calls ? hits / calls : null;
    let recommendation = '';
    if (calls < minCalls) recommendation = `too few calls (< ${minCalls})`;
    else if (errors / calls > 0.2) recommendation = 'FLAKY (errors > 20 %)';
    else if (paid && hits === 0) recommendation = 'CUT CANDIDATE';
    else if (paid && hitRate! < 0.1) recommendation = 'LOW YIELD (< 10 % hits)';
    else if (hitRate! >= 0.5) recommendation = 'KEEP';
    else recommendation = 'ok';
    return {
      provider: rs[0].provider, tool: rs[0].tool, calls, hits, misses, errors, hit_rate: hitRate === null ? null : round(hitRate, 3),
      credits: round(credits), credits_per_hit: hits ? round(credits / hits, 3) : null,
      median_ms: median(rs.map((r) => r.durationMs).filter((d): d is number => typeof d === 'number')), paid, recommendation,
    };
  });
  return rows.sort((a, b) => b.credits - a.credits || b.calls - a.calls || `${a.provider}/${a.tool}`.localeCompare(`${b.provider}/${b.tool}`));
}

export function renderScorecard(rows: ScorecardRow[], since?: string): string {
  const pct = (r: number | null) => (r === null ? 'n/a' : `${(r * 100).toFixed(1)} %`);
  const lines = [
    `PROVIDER SCORECARD${since ? `  since ${since}` : ''}  (${rows.reduce((a, r) => a + r.calls, 0)} calls, ${round(rows.reduce((a, r) => a + r.credits, 0))} credits)`,
    '',
    '| provider | tool | calls | hits | misses | errors | hit rate | credits | credits/hit | median ms | recommendation |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...rows.map((r) => `| ${r.provider} | ${r.tool} | ${r.calls} | ${r.hits} | ${r.misses} | ${r.errors} | ${pct(r.hit_rate)} | ${r.credits} | ${r.credits_per_hit ?? 'n/a'} | ${r.median_ms ?? 'n/a'} | ${r.recommendation} |`),
  ];
  return lines.join('\n');
}
