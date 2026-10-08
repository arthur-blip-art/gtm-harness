import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { apexDomain } from '../core/normalize.ts';
import { callLeg, canRun } from '../core/leg.ts';
import { atsJobs, companyNews, jobSignals, newsSignals, readSite, type NewsItem } from '../core/site.ts';
import { dmarcPolicy, fingerprint, type Tech } from '../core/tech-fingerprint.ts';
import { isFresh } from '../core/signal-rules.ts';
import { renderBrief } from '../core/brief.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'account-context';
export const DESCRIPTION = 'What to know before writing to an account, free first: its website (pricing, customers, integrations, careers, team), DNS and tech stack, open jobs from its ATS, dated news. Then one LLM pass that names the strongest dated fact and the angles, every fact with its source URL. Writes signals and an optional markdown brief.';

export const Input = z.object({
  domain: z.string().min(1),
  company: z.string().optional().describe('display name; read from the site title when absent'),
  offer: z.string().optional().describe('what we sell, one paragraph: lets the brief say why this account, why now'),
  news_days: z.number().int().min(7).max(730).default(180),
  phone: z.boolean().default(true).describe('company switchboard: tel: links on the site, else Google Maps via Serper (~$0.003)'),
  llm: z.boolean().default(true).describe('synthesis by the LLM when ANTHROPIC_API_KEY is set; facts only otherwise'),
  out_dir: z.string().optional().describe('write <out_dir>/<domain>.md and .json'),
});
export type Input = z.infer<typeof Input>;

export interface Fact { fact: string; source_url: string; date?: string | null; kind: string }
export interface Angle { angle: string; fact: string; source_url: string }
export interface Summary { one_liner: string; sells_to: string; business_model: string; why_now: string; angles: Angle[]; unknowns: string[]; by: 'llm' | 'rules' }
export interface Output {
  domain: string; name: string; reachable: boolean; pages: Record<string, string>; social: Record<string, string>;
  tech: Tech[]; email: { suite: string | null; dmarc: string | null };
  jobs: { ats: string | null; count: number; titles: string[] }; news: NewsItem[]; signals: Signal[];
  phone: { number: string; source: string } | null; facts: Fact[]; summary: Summary; brief_path?: string;
}

const SUMMARY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['one_liner', 'sells_to', 'business_model', 'why_now', 'angles', 'unknowns'],
  properties: {
    one_liner: { type: 'string', description: 'What the company sells, in one plain sentence, from its own pages.' },
    sells_to: { type: 'string', description: 'Who buys it (segment, size, role), as stated on the site; "unknown" otherwise.' },
    business_model: { type: 'string', description: 'Pricing model and motion (self-serve, sales-led, usage-based…) as read on the pricing page; "unknown" otherwise.' },
    why_now: { type: 'string', description: 'The single strongest dated reason to write this month, quoting one fact from the list, or "no dated trigger".' },
    angles: { type: 'array', description: 'Up to 3 angles.', items: { type: 'object', additionalProperties: false, required: ['angle', 'fact', 'source_url'], properties: { angle: { type: 'string' }, fact: { type: 'string' }, source_url: { type: 'string' } } } },
    unknowns: { type: 'array', items: { type: 'string' }, description: 'Up to 5 things a seller should check before writing.' },
  },
} as const;

const titleName = (t: string | null | undefined, domain: string) => (t ?? '').split(/[|\-–—:·]/)[0].trim() || domain.split('.')[0].replace(/^\w/, (c) => c.toUpperCase());

export async function accountContext(input: Input, ctx: PlayCtx): Promise<Output> {
  const domain = apexDomain(input.domain) ?? input.domain;
  const site = await readSite(ctx, domain);
  const name = input.company ?? titleName(site.home?.title, domain);
  const facts: Fact[] = [];
  const pageUrls: Record<string, string> = {};
  if (site.home) { pageUrls.home = site.home.url; if (site.home.description) facts.push({ fact: `Site description: ${site.home.description}`, source_url: site.home.url, kind: 'site' }); }
  for (const [kind, p] of Object.entries(site.pages)) {
    pageUrls[kind] = p!.url;
    facts.push({ fact: `${kind} page: ${p!.text.slice(0, 600).replace(/\s+/g, ' ')}`, source_url: p!.url, kind });
  }

  // JS-only sites give an empty page: one ScrapeGraph render (~$0.02-0.05), only then.
  if (site.home && site.home.text_length < 400 && canRun(ctx, 'scrapegraph')) {
    const rc = await callLeg(ctx, 'scrapegraph:home', 'scrapegraph', 'smartscraper', { url: site.home.url, prompt: 'What does this company sell, to whom, at what price model; name customers and integrations shown.' });
    if (rc?.status === 'hit') facts.push({ fact: `Rendered homepage: ${JSON.stringify((rc.output as any).result).slice(0, 800)}`, source_url: site.home.url, kind: 'site' });
  }

  // DNS + website + job ads → tech stack, free
  const dnsRc = await callLeg(ctx, 'dns', 'web', 'dns_records', { domain });
  const dns = dnsRc?.status === 'hit' ? (dnsRc.output as any) : null;
  const { ats, jobs } = await atsJobs(ctx, site.ats);
  const tech = fingerprint({ dns, pages: [site.home, ...Object.values(site.pages)].filter(Boolean) as any, jobs });
  const suite = tech.find((t) => t.category === 'email_suite')?.name ?? null;
  for (const t of tech.filter((t) => t.category !== 'email_suite' && t.category !== 'consent')) facts.push({ fact: `Uses ${t.name} (${t.category}), seen in ${t.layer}: ${t.evidence}`, source_url: t.layer === 'website' ? (t.evidence.split(' on ').pop() ?? site.home?.url ?? '') : t.layer === 'jobs' ? (/https?:\S+/.exec(t.evidence)?.[0] ?? site.urls.careers ?? '') : `dns:${domain}`, kind: 'tech' });
  const recentJobs = jobs.filter((j) => !j.posted_at || isFresh('job_opening', j.posted_at) || Date.now() - Date.parse(j.posted_at) < 120 * 86400000);
  if (jobs.length) facts.push({ fact: `${jobs.length} open roles on ${ats}: ${jobs.slice(0, 8).map((j) => j.title).join('; ')}`, source_url: site.urls.careers ?? jobs[0].url ?? '', kind: 'jobs', date: recentJobs[0]?.posted_at ?? null });

  // News, free first
  const news = await companyNews(ctx, name, input.news_days);
  for (const n of news.filter((n) => n.type)) facts.push({ fact: `${n.type}: ${n.title}${n.source ? ` (${n.source})` : ''}`, source_url: n.link, date: n.published_at, kind: n.type! });

  // Switchboard: the site first, Maps only when the site has none
  let phone: Output['phone'] = null;
  const sitePhone = [site.home, ...Object.values(site.pages)].flatMap((p) => p?.phones ?? [])[0];
  if (sitePhone) phone = { number: sitePhone, source: site.urls.contact ?? site.home!.url };
  else if (input.phone && canRun(ctx, 'serper')) {
    const rc = await callLeg(ctx, 'phone:maps', 'serper', 'places', { q: `${name} ${domain}` });
    const hit = ((rc?.output as any)?.places ?? []).find((p: any) => p.phone && (!p.website || apexDomain(p.website) === domain));
    if (hit) phone = { number: hit.phone, source: `google maps: ${hit.title}` };
  }

  const signals = [...newsSignals(domain, news), ...(ats ? jobSignals(domain, ats, jobs) : [])];
  await ctx.store.upsertSignals(signals);
  await ctx.store.upsertCompany({ domain, name, tech: tech.map((t) => t.name), linkedinUrl: site.social.linkedin, fieldSources: { name: site.home ? 'website' : 'input', tech: 'fingerprint' }, raw: { context: { pages: pageUrls, at: new Date().toISOString() } } });

  const summary = await summarize(ctx, input, name, domain, facts, site.home?.description ?? null);
  const out: Output = {
    domain, name, reachable: !!site.home, pages: pageUrls, social: site.social as Record<string, string>, tech,
    email: { suite, dmarc: dmarcPolicy(dns?.dmarc) }, jobs: { ats, count: jobs.length, titles: jobs.slice(0, 15).map((j) => j.title) },
    news, signals, phone, facts, summary,
  };
  if (input.out_dir) {
    fs.mkdirSync(input.out_dir, { recursive: true });
    out.brief_path = path.join(input.out_dir, `${domain}.md`);
    fs.writeFileSync(out.brief_path, renderBrief(out));
    fs.writeFileSync(path.join(input.out_dir, `${domain}.json`), JSON.stringify(out, null, 2));
  }
  return out;
}

async function summarize(ctx: PlayCtx, input: Input, name: string, domain: string, facts: Fact[], description: string | null): Promise<Summary> {
  const dated = facts.filter((f) => f.date && isFresh(f.kind, f.date)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const rules: Summary = {
    one_liner: description ?? `${name} (${domain})`, sells_to: 'unknown', business_model: 'unknown',
    why_now: dated[0] ? `${dated[0].fact} (${dated[0].date?.slice(0, 10)})` : 'no dated trigger',
    angles: dated.slice(0, 3).map((f) => ({ angle: f.kind, fact: f.fact, source_url: f.source_url })), unknowns: ['who owns the problem internally', 'current tooling for the problem we solve'], by: 'rules',
  };
  if (!input.llm || !canRun(ctx, 'llm') || !facts.length) return rules;
  const list = facts.map((f, k) => `[${k + 1}] (${f.kind}${f.date ? `, ${f.date.slice(0, 10)}` : ''}) ${f.fact}\n    source: ${f.source_url}`).join('\n');
  const rc = await callLeg(ctx, 'llm:context', 'llm', 'generate', {
    task: 'account_context',
    system: 'You are a B2B research analyst preparing a seller before first contact. Use only the numbered facts given. Every angle quotes one fact and copies its source URL exactly. Write plain, specific sentences; no superlatives, no guessing. If a field cannot be answered from the facts, say "unknown".',
    prompt: `Company: ${name} (${domain})\nToday: ${new Date().toISOString().slice(0, 10)}\n${input.offer ? `What we sell:\n${input.offer}\n` : ''}\nFacts:\n${list}\n\nReturn the brief.`,
    schema: SUMMARY_SCHEMA,
  });
  const r = rc?.status === 'hit' ? ((rc.output as any).result as Omit<Summary, 'by'>) : null;
  if (!r) return rules;
  // An angle whose URL is not one we read is dropped: no invented sources.
  const known = new Set(facts.map((f) => f.source_url));
  return { ...r, angles: (r.angles ?? []).filter((a) => known.has(a.source_url)).slice(0, 3), unknowns: (r.unknowns ?? []).slice(0, 5), by: 'llm' };
}

export const play = definePlay<Input, Output>({ name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input, run: accountContext });
