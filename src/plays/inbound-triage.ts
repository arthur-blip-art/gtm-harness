import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { apexDomain, emailDomain, normalizeEmail } from '../core/normalize.ts';
import { createNotifier } from '../core/notify.ts';
import { DEFAULT_ENGAGEMENT_MODEL, DEFAULT_FIT_MODEL } from '../core/scoring-rules.ts';
import { legEnabled } from './name-domain-to-email.ts';
import { suppressPeople } from './suppress.ts';
import type { CompanyProfile } from './company-enrich.ts';
import type { LegMeta } from '../core/types.ts';
import type { Score, Signal } from '../store/store.ts';

export const NAME = 'inbound-triage';
export const DESCRIPTION = 'Triage new inbound leads (HubSpot contacts created in the last N hours, or a pasted list): disqualify early with a reason, enrich and score the rest, tier hot/warm/cold with a next action and an angle, optionally write back to HubSpot, Slack digest of new hot/warm only.';

export const DEFAULT_COMPETITORS = ['codat.io', 'merge.dev', 'apideck.com', 'rutter.com', 'kombo.dev'];

const Contact = z.object({
  email: z.string(), firstname: z.string().optional(), lastname: z.string().optional(), jobtitle: z.string().optional(),
  company: z.string().optional(), message: z.string().optional(), source: z.string().optional(), id: z.string().optional().describe('HubSpot contact id, needed for write'),
});
export const Input = z.object({
  since_hours: z.number().int().min(1).max(24 * 30).default(24).describe('read HubSpot contacts created in the last N hours (ignored when contacts is given)'),
  contacts: z.array(Contact).optional().describe('leads pasted by hand instead of reading HubSpot: {email, firstname, lastname, jobtitle, company, message, source}'),
  write: z.boolean().default(false).describe('update the HubSpot contact with gtm_inbound_tier, gtm_inbound_reason, gtm_next_action'),
  notify: z.boolean().default(true),
  competitors_domains: z.array(z.string()).default(DEFAULT_COMPETITORS),
  own_domain: z.string().default('chift.eu'),
  max_contacts: z.number().int().min(1).max(1000).default(200),
});
export type Input = z.infer<typeof Input>;

export type InboundTier = 'hot' | 'warm' | 'cold' | 'disqualified';
export interface Lead {
  email: string; name: string; title: string; domain: string | null; tier: InboundTier; reason: string; next_action: string; angle: string;
  fit_tier: string | null; engagement_tier: string | null; source?: string; hubspot_id?: string; new: boolean;
}
export interface Output { leads: Lead[]; counts: Record<InboundTier, number>; new_leads: number; written: number; notified: 'sent' | 'skipped' | 'failed' | 'none' }

export const NEXT_ACTION: Record<InboundTier, string> = {
  hot: 'répondre < 1 h + call-prep',
  warm: 'séquence nurturing',
  cold: 'newsletter / pas d\'action',
  disqualified: 'refus poli ou referral',
};

const PERSONAL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com', 'yahoo.com', 'yahoo.fr', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.fr', 'gmx.de', 'web.de', 'mail.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'neuf.fr', 'laposte.net', 'bbox.fr', 'skynet.be', 'telenet.be', 'ziggo.nl', 'kpnmail.nl', 'libero.it', 'tutanota.com', 'yandex.com', 'zoho.com']);
const STUDENT = /\b(student|[ée]tudiante?|stagiaire|intern|internship|alternante?|alternance|apprentie?|job ?seeker|looking for (a )?(job|opportunit)|en recherche d'emploi|demandeur d'emploi)\b/i;
/** Tech/product/partnership owner: the people who sign an integration budget. */
const DECIDER = /\b(cto|cpo|chief (technology|technical|product) officer|(vp|vice[- ]president|head|director|directeur|directrice|responsable)\b.{0,24}\b(product|produit|engineering|eng|technique|technology|tech|partnerships?|partenariats?|integrations?|platform))/i;
/** Founder/CEO decides alone only in small companies (< 200 people, or size unknown). */
const FOUNDER = /\b(co-?founder|founder|fondat(eur|rice)|ceo|chief executive|pdg|directeur g[ée]n[ée]ral|managing director)\b/i;
/** The message itself says "we need what Chift sells". */
export const INTENT = /\b(int[ée]grat\w*|connect\w*|connecteurs?|api|comptab\w*|accounting|bookkeeping|erp|invoic\w*|factur\w*|pennylane|sage|exact|odoo|quickbooks|xero|netsuite|cegid|unified)\b/i;
const SOFTWARE_NAMES = /\b(pennylane|sage|exact|odoo|quickbooks|xero|netsuite|cegid|datev|yuki|octopus|winbooks|horus|tiime|qonto|stripe)\b/gi;

const key = (...parts: unknown[]) => sha256(parts.map(String).join('|')).slice(0, 32);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface AccountView { fit_tier: string | null; engagement_tier: string | null; fit_score: number | null; profile?: CompanyProfile }

/**
 * Absolute grade when the percentile grade is missing: score-accounts grades against the scored
 * population, so a run on 1–3 domains (typical for inbound) has no reference variation. Thresholds
 * are a share of the model's maximum (sum of weights): ≥ 85 % A, ≥ 70 % B, ≥ 50 % C, else D.
 */
function absoluteGrade(score: number | null, maxScore: number): string | null {
  if (score === null || maxScore <= 0) return null;
  const r = score / maxScore;
  return r >= 0.85 ? 'A' : r >= 0.7 ? 'B' : r >= 0.5 ? 'C' : 'D';
}
const maxOf = (w: Record<string, number>) => Object.values(w).reduce((a, x) => a + Math.max(0, x), 0);

/** company-enrich each domain, then one score-accounts over all of them. Shared with site-visitors. */
export async function enrichAndScore(domains: string[], ctx: PlayCtx): Promise<Map<string, AccountView>> {
  const out = new Map<string, AccountView>();
  if (!domains.length) return out;
  const profiles = new Map<string, CompanyProfile>();
  for (const d of domains) profiles.set(d, await ctx.runPlay<{ domain: string }, CompanyProfile>('company-enrich', { domain: d }));
  const scored = await ctx.runPlay<{ domains: string[] }, { scores: Score[] }>('score-accounts', { domains });
  const pick = (d: string, dim: Score['dimension'], max: number) => {
    const s = scored.scores.find((x) => x.domain === d && x.dimension === dim);
    return { tier: s?.tier ?? absoluteGrade(s?.score ?? null, max), score: s?.score ?? null };
  };
  for (const d of domains) {
    const fit = pick(d, 'account_fit', maxOf(DEFAULT_FIT_MODEL.weights));
    const eng = pick(d, 'account_engagement', maxOf(DEFAULT_ENGAGEMENT_MODEL.weights));
    out.set(d, { fit_tier: fit.tier, engagement_tier: eng.tier, fit_score: fit.score, profile: profiles.get(d) });
  }
  return out;
}

async function readHubspot(input: Input, ctx: PlayCtx) {
  const meta: LegMeta = { leg: 'hubspot_inbound', provider: 'hubspot', tool: 'search_objects', rowsReached: 1, accepted: 0, receiptIds: [] };
  ctx.metas.push(meta);
  const since = String(Date.now() - input.since_hours * 3600000);
  const rows: Array<z.infer<typeof Contact>> = [];
  let after: string | null = null;
  do {
    const rc = await ctx.runner.execute({
      provider: 'hubspot', tool: 'search_objects', runId: ctx.runId,
      input: { objectType: 'contacts', filters: [{ propertyName: 'createdate', operator: 'GTE', value: since }], sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        properties: ['email', 'firstname', 'lastname', 'jobtitle', 'company', 'hs_analytics_source', 'message', 'lifecyclestage', 'createdate'], limit: 100, ...(after ? { after } : {}) },
    });
    meta.receiptIds!.push(rc.id);
    if (rc.status !== 'hit') break;
    const o = (rc.output as any) ?? {};
    for (const r of o.results ?? []) {
      const p = r.properties ?? {};
      if (p.email) rows.push({ id: r.id, email: p.email, firstname: p.firstname, lastname: p.lastname, jobtitle: p.jobtitle, company: p.company, message: p.message, source: p.hs_analytics_source });
    }
    after = o.next ?? o.paging?.next?.after ?? null;
  } while (after && rows.length < input.max_contacts);
  meta.accepted = rows.length;
  return rows.slice(0, input.max_contacts);
}

/** Short opening angle: the lead's own words first, then what the account data says. */
function angleFor(c: z.infer<typeof Contact>, view?: AccountView): string {
  const msg = (c.message ?? '').replace(/\s+/g, ' ').trim();
  if (msg && INTENT.test(msg)) {
    const tools = [...new Set((msg.match(SOFTWARE_NAMES) ?? []).map((t) => t[0].toUpperCase() + t.slice(1).toLowerCase()))];
    return clip(tools.length ? `veut connecter ${tools.join(' + ')} : « ${msg} »` : `« ${msg} »`, 160);
  }
  const p = view?.profile;
  const bits = [
    p?.fundingLastRound && p.fundingLastDate ? `${p.fundingLastRound} (${p.fundingLastDate.slice(0, 7)})` : null,
    p?.headcount ? `${p.headcount} pers.` : null,
    p?.tech?.length ? `stack ${p.tech.slice(0, 3).join(', ')}` : null,
  ].filter(Boolean);
  if (msg) bits.unshift(`« ${clip(msg, 80)} »`);
  return bits.length ? clip(bits.join(' · '), 160) : `inbound ${c.source ?? 'site'} sans message : demander le cas d'usage`;
}

/**
 * Tier rule (documented, deterministic):
 *   hot  = fit A/B AND (decision-maker title OR the message talks integration / accounting / API)
 *   warm = fit A/B/C without either, or intent/decider with an unknown fit (enrichment missed)
 *   cold = everything else (fit D, or unknown fit and no intent)
 * Decision-maker = CTO, CPO, VP/Head/Director of Product/Engineering/Partnerships/Integrations,
 * or founder/CEO of a company under 200 people (size unknown counts as small: inbound founders usually are).
 */
export function tierOf(fit: string | null, title: string, message: string, headcount?: number): { tier: Exclude<InboundTier, 'disqualified'>; why: string[] } {
  const decider = DECIDER.test(title) || (FOUNDER.test(title) && (headcount == null || headcount < 200));
  const intent = INTENT.test(message);
  const why = [`fit ${fit ?? '?'}`, ...(decider ? ['décideur'] : []), ...(intent ? ['message intégration/compta'] : [])];
  if ((fit === 'A' || fit === 'B') && (decider || intent)) return { tier: 'hot', why };
  if (fit === 'A' || fit === 'B' || fit === 'C' || (fit === null && (decider || intent))) return { tier: 'warm', why };
  return { tier: 'cold', why };
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const counts: Output['counts'] = { hot: 0, warm: 0, cold: 0, disqualified: 0 };
    let contacts = input.contacts;
    if (!contacts) {
      if (!legEnabled(ctx, 'hubspot')) {
        ctx.log('HUBSPOT_TOKEN missing and no contacts given: nothing to triage (use --dry-run or pass contacts)');
        return { leads: [], counts, new_leads: 0, written: 0, notified: 'none' };
      }
      contacts = await readHubspot(input, ctx);
    }
    const own = apexDomain(input.own_domain);
    const competitors = new Set(input.competitors_domains.map((d) => apexDomain(d)).filter(Boolean));

    // (b) early disqualification, cheapest checks first; nothing here costs a credit
    const leads = new Map<string, Lead>();
    const contactOf = new Map<string, z.infer<typeof Contact>>();
    const survivors: Array<{ email: string; domain: string }> = [];
    for (const c of contacts) {
      const email = normalizeEmail(c.email);
      if (!email || contactOf.has(email)) continue;
      contactOf.set(email, c);
      const host = emailDomain(email);
      const domain = apexDomain(host);
      const title = (c.jobtitle ?? '').trim();
      const base = { email, name: [c.firstname, c.lastname].filter(Boolean).join(' ').trim() || email.split('@')[0], title, domain, fit_tier: null, engagement_tier: null, source: c.source, hubspot_id: c.id, new: true };
      const dq = (reason: string) => leads.set(email, { ...base, tier: 'disqualified', reason, next_action: NEXT_ACTION.disqualified, angle: '' });
      if (!domain) dq('no_domain');
      else if (PERSONAL.has(host ?? '') || PERSONAL.has(domain)) dq(`email perso (${host})`);
      else if (own && domain === own) dq('domaine propre');
      else if (competitors.has(domain)) dq(`concurrent (${domain})`);
      else if (STUDENT.test(title)) dq(`étudiant/stagiaire (${title})`);
      else survivors.push({ email, domain });
    }

    // customers and partners are not new business; no cooldown: an inbound who writes is answered even if we contacted them
    const sup = survivors.length ? await suppressPeople(survivors, ctx, { cooldown_days: 0 }) : { kept: [], dropped: [] };
    const openDeal = new Set<string>();
    for (const d of sup.dropped) {
      const c = contactOf.get(d.email)!;
      if (d.suppress_reason === 'customer' || d.suppress_reason === 'partner') {
        leads.set(d.email, { email: d.email, name: [c.firstname, c.lastname].filter(Boolean).join(' '), title: c.jobtitle ?? '', domain: d.domain, tier: 'disqualified', reason: `déjà ${d.suppress_reason === 'customer' ? 'client' : 'partenaire'} : router vers le CSM/partner manager`, next_action: NEXT_ACTION.disqualified, angle: '', fit_tier: null, engagement_tier: null, source: c.source, hubspot_id: c.id, new: true });
      } else {
        if (d.suppress_reason === 'open_deal') openDeal.add(d.email);
        sup.kept.push(d); // opt-out / recent contact do not disqualify an inbound
      }
    }

    // (c) enrich + score the survivors, (d) tier, (e) next action + angle
    const views = await enrichAndScore([...new Set(sup.kept.map((p) => p.domain))], ctx);
    for (const p of sup.kept) {
      const c = contactOf.get(p.email)!;
      const v = views.get(p.domain);
      const { tier, why } = tierOf(v?.fit_tier ?? null, c.jobtitle ?? '', c.message ?? '', v?.profile?.headcount);
      if (openDeal.has(p.email)) why.push('deal ouvert : prévenir le owner');
      leads.set(p.email, {
        email: p.email, name: [c.firstname, c.lastname].filter(Boolean).join(' ').trim() || p.email.split('@')[0], title: c.jobtitle ?? '', domain: p.domain,
        tier, reason: why.join(', '), next_action: NEXT_ACTION[tier], angle: angleFor(c, v), fit_tier: v?.fit_tier ?? null, engagement_tier: v?.engagement_tier ?? null, source: c.source, hubspot_id: c.id, new: true,
      });
    }

    // (h) one signal per email, ever: the diff decides what is new
    const all = [...leads.values()];
    const now = new Date().toISOString();
    const signals: Signal[] = all.map((l) => ({ dedupeKey: key('inbound_lead', l.email), domain: l.domain ?? emailDomain(l.email) ?? 'unknown', type: 'inbound_lead', source: l.source ? `hubspot:${l.source}` : 'inbound', observedAt: now, value: { email: l.email, name: l.name, title: l.title, tier: l.tier, reason: l.reason, next_action: l.next_action, angle: l.angle, fit_tier: l.fit_tier } }));
    const seen = new Set((await ctx.store.listSignals([...new Set(signals.map((s) => s.domain))])).filter((s) => s.type === 'inbound_lead').map((s) => s.dedupeKey));
    for (const [i, l] of all.entries()) l.new = !seen.has(signals[i].dedupeKey);
    await ctx.store.upsertSignals(signals);

    // (f) HubSpot write-back, opt-in
    let written = 0;
    if (input.write && legEnabled(ctx, 'hubspot')) {
      const meta: LegMeta = { leg: 'hubspot_write', provider: 'hubspot', tool: 'update', rowsReached: 0, accepted: 0, receiptIds: [] };
      ctx.metas.push(meta);
      for (const l of all.filter((x) => x.hubspot_id)) {
        meta.rowsReached++;
        const rc = await ctx.runner.execute({ provider: 'hubspot', tool: 'update', runId: ctx.runId, input: { objectType: 'contacts', id: l.hubspot_id, properties: { gtm_inbound_tier: l.tier, gtm_inbound_reason: clip(l.reason, 250), gtm_next_action: l.next_action } } });
        meta.receiptIds!.push(rc.id);
        if (rc.status === 'hit') written++;
      }
      meta.accepted = written;
    } else if (input.write) ctx.log('write: HUBSPOT_TOKEN missing, nothing written');

    const order: InboundTier[] = ['hot', 'warm', 'cold', 'disqualified'];
    all.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
    for (const l of all) counts[l.tier]++;

    // (g) Slack: only new hot/warm, header + at most 9 lines
    let notified: Output['notified'] = 'none';
    const fresh = all.filter((l) => l.new && (l.tier === 'hot' || l.tier === 'warm'));
    if (input.notify && fresh.length) {
      const lines = fresh.slice(0, 9).map((l) => `• ${l.tier === 'hot' ? 'HOT' : 'warm'} ${l.name} (${l.title || '?'}, ${l.domain}) fit ${l.fit_tier ?? '?'} → ${l.next_action}${l.angle ? ` — ${clip(l.angle, 90)}` : ''}`);
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`Inbound: ${fresh.filter((l) => l.tier === 'hot').length} hot, ${fresh.filter((l) => l.tier === 'warm').length} warm (new)\n${lines.join('\n')}`);
    }
    const newLeads = all.filter((l) => l.new).length;
    ctx.log(`${all.length} leads (${order.map((t) => `${t}=${counts[t]}`).join(', ')}), ${newLeads} new, ${written} written, slack=${notified}`);
    return { leads: all, counts, new_leads: newLeads, written, notified };
  },
});
