import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { apexDomain } from '../core/normalize.ts';
import { createNotifier } from '../core/notify.ts';
import { legEnabled } from './name-domain-to-email.ts';
import { callTool } from './market-watch.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'competitor-customers';
export const DESCRIPTION = 'Named customers of competitors (Codat, Merge, Apideck…) from their customer pages and Google ("powered by", case studies): accounts that already buy a unified API. Candidate domains with confidence and evidence URL → companies + competitor_customer signals, optional enrich and score, Slack digest of the new ones.';

const DEFAULT_QUERIES = ['"powered by {name}"', '"{name}" "case study"', '"built with {name}" integration', 'site:{domain} customers'];
/** Never a customer: social networks, media, directories, app stores, big platforms. */
const NOISE = new Set(['linkedin.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'medium.com', 'substack.com', 'reddit.com',
  'g2.com', 'capterra.com', 'capterra.fr', 'getapp.com', 'trustpilot.com', 'trustradius.com', 'producthunt.com', 'crunchbase.com', 'dealroom.co', 'pitchbook.com', 'techcrunch.com', 'sifted.eu',
  'maddyness.com', 'lesechos.fr', 'forbes.com', 'businesswire.com', 'prnewswire.com', 'github.com', 'gitlab.com', 'stackoverflow.com', 'wikipedia.org', 'google.com', 'apple.com', 'microsoft.com',
  'amazon.com', 'w3.org', 'schema.org', 'cloudflare.com', 'gstatic.com', 'googleapis.com', 'hubspot.com', 'hsforms.com', 'calendly.com', 'vimeo.com', 'wistia.com', 'typeform.com', 'notion.so', 'example.com']);
const OWN = ['chift.eu'];
const RANK = { low: 0, medium: 1, high: 2 } as const;
type Confidence = keyof typeof RANK;

export const Input = z.object({
  competitors: z.array(z.object({
    name: z.string().min(1),
    domain: z.string().min(1),
    customer_pages: z.array(z.string().url()).default([]).describe('official customer / case-study pages: outbound links there are high confidence'),
  })).min(1),
  queries_per_competitor: z.array(z.string()).default(DEFAULT_QUERIES).describe('Google queries, {name} and {domain} are substituted'),
  exclude_domains: z.array(z.string()).default([]).describe('customers, partners, anything not to surface'),
  max_results: z.number().int().min(1).max(100).default(10).describe('Google results per query'),
  enrich: z.boolean().default(false).describe('run company-enrich then score-accounts on the new candidates (costs credits)'),
  max_enrich: z.number().int().min(1).max(200).default(25),
  notify: z.boolean().default(true),
});
export type Input = z.infer<typeof Input>;
export interface Candidate { domain: string; competitor: string; confidence: Confidence; evidence_url: string; via: 'customer_page' | 'search_result' | 'search_snippet' }
export interface Output { candidates: Candidate[]; new_candidates: number; enriched: number; notified: 'sent' | 'skipped' | 'failed' | 'none'; signals: Signal[] }

const key = (...parts: unknown[]) => sha256(parts.map(String).join('|')).slice(0, 32);
const DOMAIN_IN_TEXT = /\b((?:[a-z0-9-]+\.)+(?:com|io|fr|eu|be|nl|de|es|it|co|ai|app|dev|tech|net|org|uk|ch|lu))\b/gi;
const MONTH = 30 * 86400000;

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const now = new Date().toISOString();
    const excluded = new Set([...OWN, ...input.exclude_domains.map((d) => apexDomain(d) ?? d), ...input.competitors.map((c) => apexDomain(c.domain) ?? c.domain)]);
    const best = new Map<string, Candidate>(); // `${domain}|${competitor}` → strongest evidence
    const consider = (raw: unknown, competitor: string, confidence: Confidence, evidence_url: string, via: Candidate['via']) => {
      const domain = apexDomain(raw);
      if (!domain || excluded.has(domain) || NOISE.has(domain)) return;
      const k = `${domain}|${competitor}`;
      const prev = best.get(k);
      if (!prev || RANK[confidence] > RANK[prev.confidence]) best.set(k, { domain, competitor, confidence, evidence_url, via });
    };

    for (const comp of input.competitors) {
      const compDomain = apexDomain(comp.domain) ?? comp.domain;
      const pages = [...comp.customer_pages];
      if (legEnabled(ctx, 'serper')) {
        for (const tpl of input.queries_per_competitor) {
          const q = tpl.replaceAll('{name}', comp.name).replaceAll('{domain}', compDomain);
          const r = await callTool(ctx, `search:${comp.name}:${tpl}`, 'serper', 'google_search', { q, num: input.max_results }, MONTH);
          const poweredBy = /powered by|built with|built on|uses /i.test(tpl);
          for (const res of (r?.out.results ?? []).slice(0, input.max_results)) {
            if (!res.link) continue;
            // a case study on the competitor's own site: fetch it, its outbound links are the customer
            if (apexDomain(res.link) === compDomain) { if (pages.length < comp.customer_pages.length + 5) pages.push(res.link); continue; }
            consider(res.link, comp.name, poweredBy ? 'medium' : 'low', res.link, 'search_result');
            for (const m of `${res.title ?? ''} ${res.snippet ?? ''}`.matchAll(DOMAIN_IN_TEXT)) consider(m[1], comp.name, 'low', res.link, 'search_snippet');
          }
        }
      }
      if (legEnabled(ctx, 'web')) {
        for (const url of new Set(pages)) {
          const r = await callTool(ctx, `customers_page:${comp.name}`, 'web', 'fetch_page', { url });
          for (const link of r?.out.links ?? []) consider(link, comp.name, 'high', url, 'customer_page');
        }
      }
    }

    const candidates = [...best.values()].sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || a.domain.localeCompare(b.domain));
    const signals: Signal[] = candidates.map((c) => ({
      dedupeKey: key('competitor_customer', c.domain, c.competitor), domain: c.domain, type: 'competitor_customer', source: 'competitor-customers', observedAt: now,
      value: { competitor: c.competitor, confidence: c.confidence, evidence_url: c.evidence_url, via: c.via },
    }));
    const domains = [...new Set(candidates.map((c) => c.domain))];
    const before = new Set((await ctx.store.listSignals(domains)).map((s) => s.dedupeKey));
    const freshIdx = signals.map((s, i) => (before.has(s.dedupeKey) ? -1 : i)).filter((i) => i >= 0);
    const fresh = freshIdx.map((i) => candidates[i]);

    const existing = new Map((await ctx.store.listCompanies(domains)).map((c) => [c.domain, c]));
    for (const d of domains) {
      const of = new Set<string>([...((existing.get(d)?.raw?.competitor_customer_of as string[] | undefined) ?? []), ...candidates.filter((c) => c.domain === d).map((c) => c.competitor)]);
      await ctx.store.upsertCompany({ domain: d, fieldSources: { competitor_customer: NAME }, raw: { competitor_customer_of: [...of].sort() } });
    }
    await ctx.store.upsertSignals(signals);

    let enriched = 0;
    if (input.enrich && fresh.length) {
      const toEnrich = [...new Set(fresh.filter((c) => c.confidence !== 'low').map((c) => c.domain))].slice(0, input.max_enrich);
      for (const domain of toEnrich) { await ctx.runPlay('company-enrich', { domain }); enriched++; }
      if (toEnrich.length) await ctx.runPlay('score-accounts', { domains: toEnrich });
    }

    let notified: Output['notified'] = 'none';
    if (input.notify && fresh.length) {
      const lines = fresh.slice(0, 10).map((c) => `• ${c.domain} — client ${c.competitor} (${c.confidence}) ${c.evidence_url}`);
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`Competitor customers: ${fresh.length} new (${fresh.filter((c) => c.confidence === 'high').length} high)\n${lines.join('\n')}`);
    }
    ctx.log(`${candidates.length} candidates (${domains.length} domains), ${fresh.length} new, ${enriched} enriched, slack=${notified}`);
    return { candidates, new_candidates: fresh.length, enriched, notified, signals: freshIdx.map((i) => signals[i]) };
  },
});
