import { defineAdapter, errorResult, httpJson } from './_adapter.ts';
import { env } from '../config.ts';
import type { ToolResult } from '../core/types.ts';

/**
 * Free public sources that work for any B2B SaaS, whatever the country:
 *   - Google News RSS: press coverage (funding, launches, executive hires, expansion), dated, with the outlet.
 *   - Hacker News (Algolia API): launches and developer mentions, the Show HN of dev-tool SaaS.
 *   - SEC EDGAR full-text search: Form D filings, i.e. US private funding rounds, with the filing date.
 * No key. Each is a first pass before paid signal APIs. Endpoints: verify against their docs.
 */
const PRICE = {
  news_search: { basis: 'free', credits: 0, note: 'Google News RSS' },
  hn_search: { basis: 'free', credits: 0, note: 'hn.algolia.com' },
  form_d_search: { basis: 'free', credits: 0, note: 'efts.sec.gov full-text search; SEC asks for a contact User-Agent' },
} as const;

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

export function parseRss(xml: string): Array<{ title: string; link: string; published_at: string | null; source: string | null }> {
  const items: Array<{ title: string; link: string; published_at: string | null; source: string | null }> = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const get = (tag: string) => { const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block); return r ? decode(r[1]) : null; };
    const title = get('title');
    const link = get('link');
    if (!title || !link) continue;
    const pub = get('pubDate');
    const t = pub ? Date.parse(pub) : NaN;
    items.push({ title, link, published_at: Number.isNaN(t) ? null : new Date(t).toISOString(), source: get('source') });
  }
  return items;
}

export const publicweb = defineAdapter({
  name: 'publicweb',
  pricing: { usdPerCredit: 0, verifiedOn: '2026-10-08 (free)', table: PRICE },
  requiredEnv: [],
  tools: {
    news_search: {
      description: 'Google News RSS search: {title, link, published_at, source} for a query over the last N days.',
      normalize: (i) => ({ q: String(i.q ?? '').replace(/\s+/g, ' ').trim(), days: Number(i.days ?? 90), hl: String(i.hl ?? 'en-US'), gl: String(i.gl ?? 'US') }),
      async execute(i, ctx): Promise<ToolResult> {
        const lang = String(i.hl).split('-')[0];
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${i.q} when:${i.days}d`)}&hl=${i.hl}&gl=${i.gl}&ceid=${i.gl}:${lang}`;
        const res = await ctx.fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; gtm-harness/0.3)' } });
        const xml = await res.text();
        if (res.status !== 200) return { status: 'error', httpStatus: res.status, error: `HTTP ${res.status}`, output: { q: i.q } };
        const items = parseRss(xml).slice(0, 30);
        return items.length ? { status: 'hit', output: { q: i.q, items, count: items.length } } : { status: 'miss', missReason: 'no_news', output: { q: i.q, items: [], count: 0 } };
      },
      cost: () => 0,
    },
    hn_search: {
      description: 'Hacker News stories and comments matching a query, newest first, over the last N days.',
      normalize: (i) => ({ query: String(i.query ?? '').trim(), days: Number(i.days ?? 90), tags: String(i.tags ?? '(story,comment)') }),
      async execute(i, ctx): Promise<ToolResult> {
        const since = Math.floor(Date.now() / 1000) - Number(i.days) * 86400;
        const { status, body } = await httpJson(ctx, `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(String(i.query))}&tags=${encodeURIComponent(String(i.tags))}&numericFilters=created_at_i>${since}&hitsPerPage=30`);
        if (status !== 200) return errorResult(status, body);
        const hits = (body?.hits ?? []).map((h: any) => ({ title: h.title ?? h.story_title ?? null, url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`, hn_url: `https://news.ycombinator.com/item?id=${h.objectID}`, created_at: h.created_at, points: h.points ?? null, comments: h.num_comments ?? null, author: h.author, text: String(h.comment_text ?? h.story_text ?? '').replace(/<[^>]+>/g, ' ').slice(0, 400) }));
        return hits.length ? { status: 'hit', output: { query: i.query, hits, count: hits.length } } : { status: 'miss', missReason: 'no_hits', output: { query: i.query, hits: [], count: 0 } };
      },
      cost: () => 0,
    },
    form_d_search: {
      description: 'SEC EDGAR Form D filings naming a company (US private offerings), newest first.',
      normalize: (i) => ({ company: String(i.company ?? '').trim(), since: String(i.since ?? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)) }),
      async execute(i, ctx): Promise<ToolResult> {
        const ua = env('SEC_USER_AGENT') ?? 'gtm-harness research (set SEC_USER_AGENT to "Company contact@email")';
        const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${i.company}"`)}&forms=D&dateRange=custom&startdt=${i.since}&enddt=${new Date().toISOString().slice(0, 10)}`;
        const { status, body } = await httpJson(ctx, url, { headers: { 'user-agent': ua, accept: 'application/json' } });
        if (status !== 200) return errorResult(status, body);
        const filings = (body?.hits?.hits ?? []).map((h: any) => {
          const s = h._source ?? {};
          const cik = String(s.ciks?.[0] ?? '').replace(/^0+/, '');
          return { filed_at: s.file_date ?? null, form: s.form ?? 'D', names: s.display_names ?? [], cik, url: cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=D` : null, location: s.biz_locations?.[0] ?? null };
        });
        return filings.length ? { status: 'hit', output: { company: i.company, filings, count: filings.length } } : { status: 'miss', missReason: 'no_filing', output: { company: i.company, filings: [], count: 0 } };
      },
      cost: () => 0,
    },
  },
});
