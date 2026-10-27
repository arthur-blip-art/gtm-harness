import { resolveMx, resolveTxt } from 'node:dns/promises';
import { costFromTable, defineAdapter, errorResult } from './_adapter.ts';
import { sha256 } from '../core/hash.ts';
import { apexDomain } from '../core/normalize.ts';

/**
 * Plain HTTP fetch and DNS, no key. `fetch_page` is never cached: page diffs (pricing, integrations,
 * changelog) need the live page every time. `dns` is cacheable: MX/TXT records move slowly.
 */
const PRICE = {
  fetch_page: { basis: 'free', credits: 0, note: 'plain GET, no provider' },
  dns: { basis: 'free', credits: 0, note: 'MX + TXT lookup' },
} as const;

const strip = (html: string) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

export const web = defineAdapter({
  name: 'web',
  pricing: { usdPerCredit: 0, verifiedOn: '2026-10-13 (no provider)', table: PRICE },
  requiredEnv: [],
  tools: {
    fetch_page: {
      description: 'GET a URL → title, visible text (≤ 20k chars), text hash, links, script sources and meta generator.',
      normalize: (i) => ({ url: String(i.url ?? '').trim() }),
      noCache: true,
      async execute(i, ctx) {
        const url = String(i.url);
        let res: Response;
        try {
          res = await ctx.fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; gtm-harness/0.2)', accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        } catch (e) {
          return { status: 'error', error: e instanceof Error ? e.message : String(e) };
        }
        const html = await res.text();
        if (res.status === 404 || res.status === 410) return { status: 'miss', missReason: 'not_found', httpStatus: res.status, output: { url } };
        if (res.status >= 400) return errorResult(res.status, { url }, `HTTP ${res.status}`);
        const text = strip(html).slice(0, 20000);
        const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
        const base = res.url || url;
        const abs = (h: string) => { try { return new URL(h, base).toString(); } catch { return null; } };
        const links = [...new Set([...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => abs(m[1])).filter((x): x is string => !!x && /^https?:/.test(x)))].slice(0, 300);
        const scripts = [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => abs(m[1])).filter((x): x is string => !!x))].slice(0, 100);
        const generator = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
        return { status: 'hit', httpStatus: res.status, output: { url, final_url: base, title, text, text_hash: sha256(text).slice(0, 32), links, scripts, generator, length: text.length } };
      },
      cost: costFromTable(PRICE.fetch_page),
    },
    dns: {
      description: 'MX and TXT records of a domain (mail provider, SPF includes, site verifications).',
      normalize: (i) => ({ domain: apexDomain(i.domain) ?? String(i.domain ?? '') }),
      async execute(i) {
        const domain = String(i.domain);
        const [mx, txt] = await Promise.all([resolveMx(domain).catch(() => []), resolveTxt(domain).catch(() => [])]);
        const out = { domain, mx: mx.map((m) => m.exchange.toLowerCase()).sort(), txt: txt.map((t) => t.join('')).sort() };
        return out.mx.length || out.txt.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_records', output: out };
      },
      cost: costFromTable(PRICE.dns),
    },
  },
});
