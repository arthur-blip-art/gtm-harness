import { costFromTable, defineAdapter, errorResult, httpJson } from './_adapter.ts';
import { env } from '../config.ts';
import { norm } from '../core/normalize.ts';

const PRICE = {
  search: { basis: 'per_call', credits: 0.05, note: '~$0.005 per search without contents' },
  answer: { basis: 'per_call', credits: 0.05, note: '~$0.005 per answer (estimate, verify against docs)' },
} as const;

/** Exa neural search. In the MVP it resolves company name → official website. */
export const exa = defineAdapter({
  name: 'exa',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-23 (estimate)', table: PRICE },
  requiredEnv: ['EXA_API_KEY'],
  tools: {
    search: {
      description: 'Web search returning URLs and titles.',
      normalize: (i) => ({ query: norm(i.query), numResults: Number(i.numResults ?? 3) }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, 'https://api.exa.ai/search', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env('EXA_API_KEY') ?? '' },
          body: JSON.stringify({ query: i.query, numResults: i.numResults, type: 'auto' }),
        });
        if (status !== 200) return errorResult(status, body, body?.error);
        const results = (body.results ?? []).map((r: any) => ({ url: r.url, title: r.title }));
        return results.length ? { status: 'hit', output: { results } } : { status: 'miss', missReason: 'no_results', output: { results } };
      },
      cost: costFromTable(PRICE.search),
    },
    answer: {
      description: 'LLM answer grounded in web search, with citations. Used to measure brand visibility in AI answers (AEO).',
      normalize: (i) => ({ query: String(i.query ?? '').replace(/\s+/g, ' ').trim() }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, 'https://api.exa.ai/answer', { // verify against docs
          method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env('EXA_API_KEY') ?? '' },
          body: JSON.stringify({ query: i.query, text: false }),
        });
        if (status !== 200) return errorResult(status, body, body?.error);
        const citations = ((body?.citations ?? []) as any[]).map((c) => ({ url: c.url, title: c.title ?? null }));
        const answer = String(body?.answer ?? '');
        return answer ? { status: 'hit', output: { answer, citations } } : { status: 'miss', missReason: 'no_answer', output: { answer, citations } };
      },
      cost: costFromTable(PRICE.answer),
    },
  },
});
