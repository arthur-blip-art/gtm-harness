import { describe, expect, it } from 'vitest';
import { buildScorecard, renderScorecard } from '../src/core/scorecard.ts';
import type { Receipt } from '../src/core/types.ts';

let n = 0;
const rc = (provider: string, tool: string, status: Receipt['status'], costCredits: number, durationMs: number, pricingBasis: Receipt['pricingBasis'] = 'per_call'): Receipt =>
  ({ id: String(n++), provider, tool, inputHash: 'h', input: {}, output: null, status, pricingBasis, costCredits, costUsd: 0, durationMs, createdAt: '2026-10-01T00:00:00Z' });

describe('provider scorecard', () => {
  it('aggregates per provider/tool and recommends', () => {
    const receipts = [
      ...Array.from({ length: 25 }, () => rc('pdl', 'person_enrich', 'miss', 0.5, 300)),
      ...Array.from({ length: 10 }, (_, k) => rc('hunter', 'email_finder', k < 6 ? 'hit' : 'miss', k < 6 ? 1 : 0, 100 + k * 10, 'per_hit')),
      ...Array.from({ length: 30 }, (_, k) => rc('hubspot', 'search_objects', k % 2 ? 'hit' : 'miss', 0, 50, 'free')),
    ];
    const rows = buildScorecard(receipts);
    const by = Object.fromEntries(rows.map((r) => [`${r.provider}/${r.tool}`, r]));
    expect(by['pdl/person_enrich']).toMatchObject({ calls: 25, hits: 0, credits: 12.5, credits_per_hit: null, recommendation: 'CUT CANDIDATE' });
    expect(by['hunter/email_finder']).toMatchObject({ calls: 10, hits: 6, hit_rate: 0.6, credits: 6, credits_per_hit: 1, median_ms: 145 });
    expect(by['hunter/email_finder'].recommendation).toMatch(/too few calls/);
    expect(by['hubspot/search_objects']).toMatchObject({ paid: false, recommendation: 'KEEP' });
    expect(rows[0].provider).toBe('pdl'); // sorted by credits
    const md = renderScorecard(rows, '2026-09-01');
    expect(md).toMatch(/\| pdl \| person_enrich \| 25 \| 0 \| 25 \| 0 \| 0.0 % \| 12.5 \| n\/a \| 300 \| CUT CANDIDATE \|/);
  });
});
