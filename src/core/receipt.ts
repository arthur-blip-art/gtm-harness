import type { Receipt } from './types.ts';

export interface LegStat {
  leg: string;
  provider: string;
  tool: string;
  rowsReached: number;
  calls: number;
  cached: number;
  hits: number;
  misses: number;
  errors: number;
  accepted: number;
  credits: number;
  usd: number;
  costPerAccepted: number | null;
  label: 'NEVER REACHED' | 'CUT CANDIDATE' | 'cached' | '';
}

export interface CostReceipt {
  runId: string;
  rowsIn: number;
  rowsAccepted: number;
  totalCredits: number;
  totalUsd: number;
  marginalCreditsPerAccepted: number | null;
  legs: LegStat[];
}

export interface LegMeta {
  leg: string;
  provider: string;
  tool: string;
  rowsReached: number;
  accepted: number;
}

/**
 * Marginal, never amortized: only this run's non-cached receipts count as spend.
 * Labels: NEVER REACHED (0 rows reached), CUT CANDIDATE (spent credits, accepted nothing),
 * cached (every call served from cache).
 */
export function buildReceipt(runId: string, rowsIn: number, receipts: Receipt[], legs: LegMeta[]): CostReceipt {
  const byKey = new Map<string, Receipt[]>();
  for (const r of receipts) {
    const k = `${r.provider}/${r.tool}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
  }
  const stats: LegStat[] = legs.map((m) => {
    const rs = byKey.get(`${m.provider}/${m.tool}`) ?? [];
    const fresh = rs.filter((r) => !r.cached);
    const credits = sum(fresh.map((r) => r.costCredits));
    const usd = sum(fresh.map((r) => r.costUsd));
    return {
      leg: m.leg, provider: m.provider, tool: m.tool, rowsReached: m.rowsReached,
      calls: rs.length, cached: rs.length - fresh.length,
      hits: rs.filter((r) => r.status === 'hit').length,
      misses: rs.filter((r) => r.status === 'miss').length,
      errors: rs.filter((r) => r.status === 'error').length,
      accepted: m.accepted, credits: round(credits), usd: round(usd),
      costPerAccepted: m.accepted > 0 ? round(credits / m.accepted) : null,
      label: '',
    };
  });
  for (const s of stats) {
    if (s.rowsReached === 0) s.label = 'NEVER REACHED';
    else if (s.calls > 0 && s.cached === s.calls) s.label = 'cached';
    else if (s.credits > 0 && s.accepted === 0) s.label = 'CUT CANDIDATE';
  }
  const totalCredits = round(sum(stats.map((s) => s.credits)));
  const rowsAccepted = sum(stats.map((s) => s.accepted));
  return {
    runId, rowsIn, rowsAccepted, totalCredits, totalUsd: round(sum(stats.map((s) => s.usd))),
    marginalCreditsPerAccepted: rowsAccepted > 0 ? round(totalCredits / rowsAccepted) : null, legs: stats,
  };
}

export function renderReceipt(r: CostReceipt): string {
  const lines = [
    `COST RECEIPT  run=${r.runId}`,
    `rows in: ${r.rowsIn}   accepted: ${r.rowsAccepted}   credits: ${r.totalCredits} (~$${r.totalUsd})   marginal credits/accepted: ${r.marginalCreditsPerAccepted ?? 'n/a'}`,
    '',
    '| leg | provider/tool | reached | calls | cached | hits | misses | errors | accepted | credits | credits/accepted | label |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of r.legs) {
    lines.push(`| ${s.leg} | ${s.provider}/${s.tool} | ${s.rowsReached} | ${s.calls} | ${s.cached} | ${s.hits} | ${s.misses} | ${s.errors} | ${s.accepted} | ${s.credits} | ${s.costPerAccepted ?? '-'} | ${s.label} |`);
  }
  return lines.join('\n');
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round = (n: number) => Math.round(n * 10000) / 10000;
