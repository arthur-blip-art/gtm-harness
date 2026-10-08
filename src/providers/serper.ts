import { costFromTable, defineAdapter, errorResult, httpJson } from './_adapter.ts';
import { env } from '../config.ts';

const PRICE = {
  google_search: { basis: 'per_call', credits: 0.01, note: '~$0.001 per query (1 Serper credit); billed even when organic is empty' },
  news: { basis: 'per_call', credits: 0.01, note: '~$0.001 per query (1 Serper credit)' },
  places: { basis: 'per_call', credits: 0.03, note: '~$0.003 per query (3 Serper credits), verify against docs' },
} as const;

const post = (path: string, payload: Record<string, unknown>, ctx: Parameters<typeof httpJson>[0]) =>
  httpJson(ctx, `https://google.serper.dev/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-API-KEY': env('SERPER_API_KEY') ?? '' }, body: JSON.stringify(payload) });

/**
 * Serper.dev: Google as JSON for ~$0.001 a query. The cheap search layer: LinkedIn dorks
 * (`site:linkedin.com/in "CTO" "Acme"`), official websites, news, and Google Maps listings
 * (the company switchboard). Default locale fr.
 */
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
    news: {
      description: 'Google News results {title, link, date, source, snippet}; tbs=qdr:m for the last month.',
      normalize: (i) => ({ q: String(i.q ?? '').replace(/\s+/g, ' ').trim(), num: Number(i.num ?? 10), gl: String(i.gl ?? 'us').toLowerCase(), tbs: String(i.tbs ?? 'qdr:m') }),
      async execute(i, ctx) {
        const { status, body } = await post('news', { q: i.q, num: i.num, gl: i.gl, tbs: i.tbs }, ctx);
        if (status !== 200) return errorResult(status, body, body?.message);
        const items = (body?.news ?? []).map((n: any) => ({ title: n.title, link: n.link, date: n.date ?? null, source: n.source ?? null, snippet: n.snippet ?? null }));
        return items.length ? { status: 'hit', output: { q: i.q, items } } : { status: 'miss', missReason: 'no_news', output: { q: i.q, items: [] } };
      },
      cost: costFromTable(PRICE.news),
    },
    places: {
      description: 'Google Maps listings {title, address, phone, website, rating}: the switchboard of a company.',
      normalize: (i) => ({ q: String(i.q ?? '').replace(/\s+/g, ' ').trim(), gl: String(i.gl ?? 'fr').toLowerCase() }),
      async execute(i, ctx) {
        const { status, body } = await post('places', { q: i.q, gl: i.gl }, ctx);
        if (status !== 200) return errorResult(status, body, body?.message);
        const places = (body?.places ?? []).map((p: any) => ({ title: p.title, address: p.address ?? null, phone: p.phoneNumber ?? null, website: p.website ?? null, rating: p.rating ?? null, category: p.category ?? null }));
        return places.length ? { status: 'hit', output: { q: i.q, places } } : { status: 'miss', missReason: 'no_places', output: { q: i.q, places: [] } };
      },
      cost: costFromTable(PRICE.places),
    },
  },
});
