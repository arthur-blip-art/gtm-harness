import type { PlayCtx } from './play.ts';
import { callLeg, canRun } from './leg.ts';
import { findAts, keyPages, socialLinks, type AtsBoard, type PageKind } from './discover.ts';
import { classifyHeadline, mentionsCompany, parseAmount, roundOf, type SignalType } from './signal-rules.ts';
import { sha256 } from './hash.ts';
import type { AtsJob } from '../providers/ats.ts';
import type { Signal } from '../store/store.ts';

/**
 * Shared free reads used by several plays (account-context, company-signals, tech-stack):
 * the website, the ATS board, the free news feed. Every read is a receipt, so a second play in the
 * same run, or a rerun, reads from cache.
 */
export interface PageOut { url: string; title: string | null; description: string | null; text: string; text_length: number; links: Array<{ href: string; text: string }>; scripts: string[]; markers: string[]; generator: string | null; phones: string[]; emails: string[] }
export interface Site { domain: string; home: PageOut | null; pages: Partial<Record<PageKind, PageOut>>; urls: Partial<Record<PageKind, string>>; ats: AtsBoard | null; social: ReturnType<typeof socialLinks> }

const DEFAULT_KINDS: PageKind[] = ['pricing', 'customers', 'integrations', 'careers', 'team'];

export async function readSite(ctx: PlayCtx, domain: string, kinds: PageKind[] = DEFAULT_KINDS, maxPages = 6): Promise<Site> {
  const site: Site = { domain, home: null, pages: {}, urls: {}, ats: null, social: {} };
  for (const url of [`https://${domain}/`, `https://www.${domain}/`]) {
    const rc = await callLeg(ctx, 'site:home', 'web', 'fetch_page', { url });
    if (rc?.status === 'hit') { site.home = rc.output as PageOut; break; }
  }
  if (!site.home) return site;
  site.urls = keyPages(site.home.links, site.home.url);
  site.social = socialLinks(site.home.links);
  let n = 0;
  for (const kind of kinds) {
    const url = site.urls[kind];
    if (!url || n >= maxPages) continue;
    n++;
    const rc = await callLeg(ctx, `site:${kind}`, 'web', 'fetch_page', { url });
    if (rc?.status === 'hit') site.pages[kind] = rc.output as PageOut;
  }
  site.ats = findAts([site.home, ...Object.values(site.pages)]);
  if (!site.ats && site.urls.careers && /greenhouse|lever|ashby|workable|recruitee/.test(site.urls.careers)) site.ats = findAts([{ links: [{ href: site.urls.careers }] }]);
  return site;
}

export async function atsJobs(ctx: PlayCtx, board: AtsBoard | null): Promise<{ ats: string | null; jobs: AtsJob[]; url: string | null }> {
  if (!board) return { ats: null, jobs: [], url: null };
  const rc = await callLeg(ctx, `ats:${board.ats}`, 'ats', board.tool, { board: board.board });
  const jobs = rc?.status === 'hit' ? ((rc.output as any).jobs as AtsJob[]) : [];
  if (rc) rc.meta.accepted = jobs.length;
  return { ats: board.ats, jobs, url: rc ? `${board.ats}:${board.board}` : null };
}

export interface NewsItem { title: string; link: string; published_at: string | null; source: string | null; type: SignalType | null; via: string }

/** Free Google News first; Serper News (~$0.001) only when the free feed returns nothing. */
export async function companyNews(ctx: PlayCtx, name: string, days: number, opts: { paidFallback?: boolean; gl?: string } = {}): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  const free = await callLeg(ctx, 'news:google_rss', 'publicweb', 'news_search', { q: `"${name}"`, days });
  for (const it of ((free?.output as any)?.items ?? []) as any[]) {
    if (!mentionsCompany(it.title, name)) continue;
    out.push({ title: it.title, link: it.link, published_at: it.published_at, source: it.source, type: classifyHeadline(it.title), via: 'google_news_rss' });
  }
  if (free?.meta) free.meta.accepted = out.length;
  if (!out.length && opts.paidFallback !== false && canRun(ctx, 'serper')) {
    const paid = await callLeg(ctx, 'news:serper', 'serper', 'news', { q: `"${name}"`, gl: opts.gl ?? 'us', tbs: days <= 31 ? 'qdr:m' : 'qdr:y' });
    for (const it of ((paid?.output as any)?.items ?? []) as any[]) {
      if (!mentionsCompany(it.title, name)) continue;
      out.push({ title: it.title, link: it.link, published_at: relativeDate(it.date), source: it.source, type: classifyHeadline(it.title), via: 'serper_news' });
    }
    if (paid?.meta) paid.meta.accepted = out.length;
  }
  return out;
}

/** Serper returns "3 days ago" / "Oct 2, 2026". */
export function relativeDate(s: unknown): string | null {
  if (typeof s !== 'string' || !s) return null;
  const m = /(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i.exec(s);
  if (m) {
    const unit = { minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3, year: 365 * 86400e3 }[m[2].toLowerCase() as 'day'];
    return new Date(Date.now() - Number(m[1]) * unit).toISOString();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const key = (...p: unknown[]) => sha256(p.map(String).join('|')).slice(0, 32);

export function newsSignals(domain: string, items: NewsItem[]): Signal[] {
  return items.filter((n) => n.type).map((n) => {
    const amount = n.type === 'funding_round' ? parseAmount(n.title) : null;
    return {
      dedupeKey: key(domain, n.type, 'news', n.link), domain, type: n.type!, source: n.via, observedAt: n.published_at ?? undefined,
      value: { title: n.title, url: n.link, outlet: n.source, ...(amount ? { amount: amount.amount, currency: amount.currency } : {}), ...(n.type === 'funding_round' && roundOf(n.title) ? { round: roundOf(n.title) } : {}) },
    };
  });
}

export function jobSignals(domain: string, ats: string, jobs: AtsJob[]): Signal[] {
  return jobs.map((j) => ({
    dedupeKey: key(domain, 'job_opening', ats, j.url ?? j.title), domain, type: 'job_opening', source: `ats:${ats}`, observedAt: j.posted_at ?? undefined,
    value: { title: j.title, url: j.url, location: j.location, department: j.department },
  }));
}
