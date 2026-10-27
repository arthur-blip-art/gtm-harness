import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { apexDomain } from '../core/normalize.ts';
import { createNotifier } from '../core/notify.ts';
import { suppressPeople } from './suppress.ts';
import { DEFAULT_COMPETITORS, enrichAndScore } from './inbound-triage.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'site-visitors';
export const DESCRIPTION = 'Score de-anonymised website visits (Snitcher, Leadfeeder, RB2B, Clearbit Reveal exports: domain + pages) by weighted page intent, drop ISPs and competitors, flag customers as expansion, enrich and score the hot accounts, Slack digest of what is new this ISO week.';

const Visit = z.object({
  domain: z.string().min(1), pages: z.array(z.string()).default([]).describe('paths viewed, e.g. /pricing'),
  visits: z.number().int().min(1).optional(), last_seen: z.string().optional().describe('ISO date'), source: z.string().optional().describe('snitcher | leadfeeder | rb2b | clearbit…'),
});
/** Regex on the path → weight; first match wins in this order (blog first: /blog/pricing-api-guide is reading, not buying), anything else weighs `default_page_weight`. */
export const DEFAULT_PAGE_WEIGHTS: Record<string, number> = {
  '(^|/)blog(/|$)': 0.5,
  'pricing|tarifs?|prix': 3,
  'integrations?|connect|connectors?|connecteurs?': 3,
  '(^|/)(vs|compare|comparison|alternatives?)(/|-|$)': 3,
  'docs?|api|developers?': 2,
};
export const Input = z.object({
  visits: z.array(Visit).min(1),
  page_weights: z.record(z.string(), z.number()).default(DEFAULT_PAGE_WEIGHTS).describe('regex on the path → weight'),
  default_page_weight: z.number().default(1),
  min_score: z.number().default(4).describe('intent score from which an account is enriched, scored and alerted'),
  enrich: z.boolean().default(true),
  notify: z.boolean().default(true),
  competitors_domains: z.array(z.string()).default(DEFAULT_COMPETITORS),
  own_domain: z.string().default('chift.eu'),
});
export type Input = z.infer<typeof Input>;

export type VisitFlag = 'customer_expansion' | 'partner' | 'open_deal' | null;
export interface Account {
  domain: string; intent_score: number; pages: string[]; visits: number; last_seen?: string; source?: string; flag: VisitFlag;
  qualified: boolean; fit_tier: string | null; engagement_tier: string | null; new: boolean;
}
export interface Output { accounts: Account[]; excluded: Array<{ domain: string; reason: string }>; qualified: number; new_signals: number; notified: 'sent' | 'skipped' | 'failed' | 'none' }

/** ISPs, clouds and big platforms: the IP resolves to the network, not the visitor's employer. */
const NETWORK = /^(orange|wanadoo|free|sfr|neuf|bouyguestelecom|bbox|numericable|proximus|telenet|skynet|scarlet|kpn|ziggo|vodafone|telefonica|movistar|telekom|t-mobile|swisscom|bt|virginmedia|sky|comcast|verizon|att|charter|spectrum|cox|amazonaws|amazon|aws|google|googleusercontent|1e100|microsoft|azure|msn|ovh|ovhcloud|scaleway|online|hetzner|digitalocean|linode|akamai|akamaitechnologies|cloudflare|fastly|oraclecloud|ibm|alibaba|leaseweb|contabo|ionos|zscaler)$/;

const key = (...parts: unknown[]) => sha256(parts.map(String).join('|')).slice(0, 32);

/** ISO-8601 week, e.g. 2026-W42 (weeks start Monday, week 1 holds the first Thursday). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** Σ page weights (each distinct path once) × log2(1 + visits): 1 visit ×1, 3 visits ×2, 7 visits ×3. */
export function intentScore(pages: string[], visits: number, weights: Record<string, number>, fallback: number): number {
  const rules = Object.entries(weights).map(([re, w]) => [new RegExp(re, 'i'), w] as const);
  const paths = [...new Set(pages.map((p) => p.trim().toLowerCase().replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '') || '/'))];
  const sum = paths.reduce((a, p) => a + (rules.find(([re]) => re.test(p))?.[1] ?? fallback), 0);
  return Math.round(sum * Math.log2(1 + Math.max(1, visits)) * 100) / 100;
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const own = apexDomain(input.own_domain);
    const competitors = new Set(input.competitors_domains.map((d) => apexDomain(d)).filter(Boolean));
    const excluded: Output['excluded'] = [];

    // merge rows per apex domain (the same company can appear under several hosts or sessions)
    const merged = new Map<string, { pages: string[]; visits: number; last_seen?: string; source?: string }>();
    for (const v of input.visits) {
      const d = apexDomain(v.domain);
      if (!d) { excluded.push({ domain: v.domain, reason: 'invalid_domain' }); continue; }
      if (NETWORK.test(d.split('.')[0])) { excluded.push({ domain: d, reason: 'isp_or_host' }); continue; }
      if (d === own) { excluded.push({ domain: d, reason: 'own_domain' }); continue; }
      if (competitors.has(d)) { excluded.push({ domain: d, reason: 'competitor' }); continue; }
      const m = merged.get(d) ?? { pages: [], visits: 0 };
      m.pages.push(...v.pages);
      m.visits += v.visits ?? 1;
      if (v.last_seen && (!m.last_seen || v.last_seen > m.last_seen)) m.last_seen = v.last_seen;
      m.source ??= v.source;
      merged.set(d, m);
    }

    // customers / partners / open deals are flagged, never dropped: a customer on /pricing is an expansion signal
    const domains = [...merged.keys()];
    const flags = new Map<string, VisitFlag>();
    if (domains.length) {
      const sup = await suppressPeople(domains.map((domain) => ({ domain })), ctx, { cooldown_days: 0 });
      for (const d of sup.dropped) {
        const f: VisitFlag = d.suppress_reason === 'customer' ? 'customer_expansion' : d.suppress_reason === 'partner' ? 'partner' : d.suppress_reason === 'open_deal' ? 'open_deal' : null;
        if (d.domain && f) flags.set(d.domain, f);
      }
    }

    const accounts: Account[] = domains.map((d) => {
      const m = merged.get(d)!;
      const intent_score = intentScore(m.pages, m.visits, input.page_weights, input.default_page_weight);
      return { domain: d, intent_score, pages: [...new Set(m.pages)], visits: m.visits, last_seen: m.last_seen, source: m.source, flag: flags.get(d) ?? null, qualified: intent_score >= input.min_score, fit_tier: null, engagement_tier: null, new: false };
    }).sort((a, b) => b.intent_score - a.intent_score);
    const qualified = accounts.filter((a) => a.qualified);

    if (input.enrich && qualified.length) {
      const views = await enrichAndScore(qualified.map((a) => a.domain), ctx);
      for (const a of qualified) { const v = views.get(a.domain); a.fit_tier = v?.fit_tier ?? null; a.engagement_tier = v?.engagement_tier ?? null; }
    }

    // one site_visit signal per domain per ISO week: a rerun the same week is silent, next week alerts again
    const now = new Date();
    const signals: Signal[] = qualified.map((a) => {
      const seen = a.last_seen && Number.isFinite(Date.parse(a.last_seen)) ? new Date(a.last_seen) : now;
      const week = isoWeek(seen);
      return { dedupeKey: key('site_visit', a.domain, week), domain: a.domain, type: 'site_visit', source: a.source ?? 'visitor-id', observedAt: seen.toISOString(), value: { week, intent_score: a.intent_score, pages: a.pages, visits: a.visits, flag: a.flag, fit_tier: a.fit_tier } };
    });
    const before = new Set((await ctx.store.listSignals(qualified.map((a) => a.domain))).map((s) => s.dedupeKey));
    const freshDomains = new Set(signals.filter((s) => !before.has(s.dedupeKey)).map((s) => s.domain));
    for (const a of qualified) a.new = freshDomains.has(a.domain);
    await ctx.store.upsertSignals(signals);

    let notified: Output['notified'] = 'none';
    const fresh = qualified.filter((a) => a.new);
    if (input.notify && fresh.length) {
      const lines = fresh.slice(0, 9).map((a) => `• ${a.domain} intent ${a.intent_score}${a.fit_tier ? ` fit ${a.fit_tier}` : ''}${a.flag ? ` [${a.flag}]` : ''} (${a.visits} visits): ${a.pages.slice(0, 4).join(', ')}`);
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`Site visitors: ${fresh.length} accounts at or above ${input.min_score} this week\n${lines.join('\n')}`);
    }
    ctx.log(`${accounts.length} accounts (${excluded.length} excluded), ${qualified.length} ≥ ${input.min_score}, ${fresh.length} new, slack=${notified}`);
    return { accounts, excluded, qualified: qualified.length, new_signals: fresh.length, notified };
  },
});
