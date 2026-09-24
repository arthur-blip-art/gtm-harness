import { costFromTable, defineAdapter, errorResult, httpJson } from './_adapter.ts';
import { env } from '../config.ts';

const PRICE = { google_search: { basis: 'per_call', credits: 0.01, note: '~$0.001 per query (1 Serper credit); billed even when organic is empty' } } as const;

/** Serper.dev: Google SERP as JSON. Default locale fr. Used for LinkedIn URL lookup and site: checks. */
export const serper = defineAdapter({
  name: 'serper',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['SERPER_API_KEY'],
  tools: {
    google_search: {
      description: 'Google search returning organic results {title, link, snippet, position}.',
      normalize: (i) => ({
        q: String(i.q ?? i.query ?? '').replace(/\s+/g, ' ').trim(),
        num: Number(i.num ?? 10),
        gl: String(i.gl ?? 'fr').toLowerCase(),
        ...(i.hl ? { hl: String(i.hl).toLowerCase() } : {}),
      }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, 'https://google.serper.dev/search', { // verify against docs
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-API-KEY': env('SERPER_API_KEY') ?? '' },
          body: JSON.stringify({ q: i.q, num: i.num, gl: i.gl, ...(i.hl ? { hl: i.hl } : {}) }),
        });
        if (status !== 200) return errorResult(status, body, body?.message ?? body?.error);
        const organic: any[] = body?.organic ?? [];
        const results = organic.map((r) => ({ title: r.title ?? null, link: r.link ?? null, snippet: r.snippet ?? null, position: r.position ?? null }));
        const out = { results, q: i.q, credits: body?.credits ?? null };
        return results.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_results', output: out };
      },
      cost: costFromTable(PRICE.google_search),
    },
  },
});
