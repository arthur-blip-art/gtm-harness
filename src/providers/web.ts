import { promises as dns } from 'node:dns';
import { defineAdapter } from './_adapter.ts';
import type { AdapterCtx, ToolResult } from '../core/types.ts';

/**
 * The free layer: the company's own website and DNS. No key, no credit, cached like any receipt,
 * so a page read twice in a run (or a week) is read once. Pages are reduced to what a play needs:
 * visible text, links, script sources and the HTML signatures the tech fingerprint reads.
 */
const PRICE = {
  fetch_page: { basis: 'free', credits: 0, note: 'plain HTTPS GET, no provider' },
  dns_records: { basis: 'free', credits: 0, note: 'MX / TXT (SPF) / DMARC lookups' },
} as const;

const UA = 'Mozilla/5.0 (compatible; gtm-harness/0.3; +https://github.com/arthur-blip-art/gtm-harness)';
const MAX_TEXT = 30_000;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parsePage(html: string, finalUrl: string) {
  const base = new URL(finalUrl);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  const links: Array<{ href: string; text: string }> = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href: string;
    try { href = new URL(m[1], base).toString(); } catch { continue; }
    if (seen.has(href) || links.length >= 400) continue;
    seen.add(href);
    links.push({ href, text: htmlToText(m[2]).slice(0, 80) });
  }
  const scripts = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 200);
  // Short markers from inline code: enough for the fingerprint, never the whole HTML.
  const inline = [...html.matchAll(/<script\b(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const markers = [...new Set((inline.match(/[a-z0-9_.-]*(hs-scripts|hubspot|segment|analytics\.js|analytics\.load|intercom|drift|crisp|zendesk|gtag|googletagmanager|fbq|_linkedin_partner_id|hotjar|mixpanel|amplitude|posthog|heap|clarity|6sense|clearbit|apollo|rb2b|warmly|koala|zoominfo|stripe|chargebee|paddle|recurly|calendly|chilipiper|navattic|storylane|onetrust|axeptio|didomi|cookiebot|sentry|datadog|launchdarkly|statsig|pendo|appcues|userpilot|gong|outreach|salesloft|lemlist|marketo|pardot|mktoforms|eloqua|klaviyo|brevo|sendinblue|mailchimp|customer\.io|webflow|framer|wp-content|__next|nuxt|gatsby|shopify)[a-z0-9_.-]*/gi) ?? []).map((s) => s.toLowerCase()))].slice(0, 80);
  const generator = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  const text = htmlToText(html);
  const phones = [...new Set([...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => decodeURIComponent(m[1]).replace(/\s+/g, ' ').trim()))].slice(0, 5);
  const emails = [...new Set([...html.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => m[1].toLowerCase()))].slice(0, 10);
  return { url: finalUrl, title, description, generator, text: text.slice(0, MAX_TEXT), text_length: text.length, links, scripts, markers, phones, emails };
}

async function fetchPage(i: Record<string, unknown>, ctx: AdapterCtx): Promise<ToolResult> {
  const url = String(i.url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await ctx.fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5', 'accept-language': 'en,fr;q=0.8' }, redirect: 'follow', signal: ctrl.signal });
    const ct = res.headers.get('content-type') ?? '';
    const body = await res.text();
    if (res.status >= 400) return { status: res.status === 404 || res.status === 410 ? 'miss' : 'error', httpStatus: res.status, missReason: `http_${res.status}`, error: res.status >= 500 ? `HTTP ${res.status}` : undefined, output: { url, status: res.status } };
    if (!/html|xml|text/i.test(ct) && ct) return { status: 'miss', missReason: 'not_html', output: { url, content_type: ct } };
    const page = parsePage(body, res.url || url);
    return page.text_length > 0 ? { status: 'hit', output: { ...page, status: res.status } } : { status: 'miss', missReason: 'empty_page', output: { ...page, status: res.status } };
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
    const msg = `${e instanceof Error ? e.message : String(e)}${cause ? ` (${cause.code ?? cause.message})` : ''}`;
    // DNS failure or refused connection is a fact about the site, not a transient error worth retrying.
    return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT|certificate|ERR_TLS/i.test(msg) ? { status: 'miss', missReason: 'unreachable', output: { url, error: msg } } : { status: 'error', error: msg, output: { url } };
  } finally {
    clearTimeout(timer);
  }
}

async function dnsRecords(i: Record<string, unknown>): Promise<ToolResult> {
  const domain = String(i.domain);
  const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
  const [mx, txt, dmarc] = await Promise.all([
    safe(dns.resolveMx(domain)),
    safe(dns.resolveTxt(domain)),
    safe(dns.resolveTxt(`_dmarc.${domain}`)),
  ]);
  const flat = (r: string[][] | null) => (r ?? []).map((parts) => parts.join(''));
  const out = { domain, mx: (mx ?? []).sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase()), txt: flat(txt), dmarc: flat(dmarc) };
  return mx || txt ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_records', output: out };
}

export const web = defineAdapter({
  name: 'web',
  pricing: { usdPerCredit: 0, verifiedOn: '2026-10-08 (free)', table: PRICE },
  requiredEnv: [],
  tools: {
    fetch_page: {
      description: 'GET a public page: title, text, links, script sources, tech markers, tel:/mailto: links.',
      normalize: (i) => ({ url: String(i.url ?? '').trim() }),
      execute: fetchPage,
      cost: () => 0,
    },
    dns_records: {
      description: 'MX, TXT (SPF and verifications) and DMARC records of a domain.',
      normalize: (i) => ({ domain: String(i.domain ?? '').trim().toLowerCase() }),
      execute: (i) => dnsRecords(i),
      cost: () => 0,
    },
  },
});
