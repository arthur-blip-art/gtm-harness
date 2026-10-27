import { costFromTable, defineAdapter, errorResult, httpJson } from './_adapter.ts';
import { norm } from '../core/normalize.ts';

/** Hacker News via the public Algolia API. Free, no key. The time window is part of the input, so the cache never serves a stale week. */
const PRICE = { search: { basis: 'free', credits: 0, note: 'public Algolia API' } } as const;

export const hackernews = defineAdapter({
  name: 'hackernews',
  pricing: { usdPerCredit: 0, verifiedOn: '2026-10-13 (free API)', table: PRICE },
  requiredEnv: [],
  tools: {
    search: {
      description: 'Stories and comments matching a query since a unix timestamp (by date).',
      normalize: (i) => ({ query: norm(i.query), since: Number(i.since ?? 0), tags: String(i.tags ?? '(story,comment)') }),
      async execute(i, ctx) {
        const qs = new URLSearchParams({ query: String(i.query), tags: String(i.tags), numericFilters: `created_at_i>${i.since}`, hitsPerPage: '50' });
        const { status, body } = await httpJson(ctx, `https://hn.algolia.com/api/v1/search_by_date?${qs}`);
        if (status !== 200) return errorResult(status, body);
        const hits = ((body?.hits ?? []) as any[]).map((h) => ({
          id: h.objectID, type: (h._tags ?? []).includes('comment') ? 'comment' : 'story', title: h.title ?? h.story_title ?? null,
          text: String(h.comment_text ?? h.story_text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
          author: h.author, url: `https://news.ycombinator.com/item?id=${h.objectID}`, link: h.url ?? h.story_url ?? null, points: h.points ?? null, created_at: h.created_at,
        }));
        return hits.length ? { status: 'hit', output: { hits, count: hits.length } } : { status: 'miss', missReason: 'no_results', output: { hits: [], count: 0 } };
      },
      cost: costFromTable(PRICE.search),
    },
  },
});
