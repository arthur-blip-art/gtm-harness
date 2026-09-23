import { costFromTable, defineAdapter, errorResult, httpJson } from './_adapter.ts';
import { env } from '../config.ts';
import { norm } from '../core/normalize.ts';

const PRICE = { search: { basis: 'per_call', credits: 0.1, note: 'estimate; phase 2 adds run_task for research briefs' } } as const;

/** Parallel web search. Skeleton for the MVP; research briefs come in phase 2. */
export const parallel = defineAdapter({
  name: 'parallel',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-23 (estimate)', table: PRICE },
  requiredEnv: ['PARALLEL_API_KEY'],
  tools: {
    search: {
      description: 'Objective-driven web search returning URLs with excerpts.',
      normalize: (i) => ({ objective: norm(i.objective ?? i.query), max_results: Number(i.max_results ?? 5) }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, 'https://api.parallel.ai/v1beta/search', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env('PARALLEL_API_KEY') ?? '' },
          body: JSON.stringify({ objective: i.objective, max_results: i.max_results }),
        });
        if (status !== 200) return errorResult(status, body, body?.error?.message);
        const results = (body.results ?? []).map((r: any) => ({ url: r.url, title: r.title, excerpts: r.excerpts }));
        return results.length ? { status: 'hit', output: { results } } : { status: 'miss', missReason: 'no_results', output: { results } };
      },
      cost: costFromTable(PRICE.search),
    },
  },
});
