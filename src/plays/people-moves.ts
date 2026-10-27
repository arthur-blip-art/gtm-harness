import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { apexDomain, ascii, norm, normalizeLinkedin } from '../core/normalize.ts';
import { createNotifier } from '../core/notify.ts';
import { legEnabled } from './name-domain-to-email.ts';
import { executeFresh } from './market-watch.ts';
import type { LegMeta } from '../core/types.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'people-moves';
export const DESCRIPTION = 'Champions who change company: reads the current LinkedIn employer of known people (customers, partners, won deals, champions), compares it to the known one, and writes a job_change signal on the NEW company domain. First sighting is a silent baseline. Slack alert on new moves only.';

const Relation = z.enum(['customer', 'partner', 'won_deal', 'champion']);
const PersonIn = z.object({
  name: z.string().optional(),
  linkedin_url: z.string().min(1),
  company: z.string().optional().describe('employer we know them at (CRM); empty = use the stored baseline'),
  domain: z.string().optional(),
  relation: Relation.optional(),
});
export const Input = z.object({
  people: z.array(PersonIn).default([]).describe('people to watch; or from_store'),
  from_store: z.boolean().default(false).describe('also watch every stored person with a linkedin_url and a domain'),
  max_profiles: z.number().int().min(1).max(500).default(50),
  max_age_days: z.number().min(0).default(7).describe('a cached profile older than this is bought again; the watch is blind without it'),
  notify: z.boolean().default(true),
});
export type Input = z.infer<typeof Input>;
type PersonIn = z.infer<typeof PersonIn>;

export interface Move { person?: string; linkedin_url: string; from_company: string | null; from_domain: string | null; to_company: string; to_domain: string | null; new_title: string | null; relation?: string }
export interface Output { checked: number; baselines: number; unchanged: number; moves: Move[]; new_moves: number; notified: 'sent' | 'skipped' | 'failed' | 'none'; signals: Signal[] }

const key = (...parts: unknown[]) => sha256(parts.map(String).join('|')).slice(0, 32);
const SUFFIX = /\b(sas|sasu|sarl|sa|sl|srl|spa|bv|nv|ag|gmbh|ltd|limited|llc|inc|corp|corporation|plc|co|group|groupe|holding|technologies|labs)\b\.?/g;
/** "Billwise SAS" → "billwise"; "Société Générale S.A." → "societegenerale". */
export const companyKey = (s: unknown) => ascii(norm(s)).replace(/\./g, '').replace(SUFFIX, ' ').replace(/[^a-z0-9]+/g, '');
const SOCIAL = /(^|\.)(linkedin|facebook|twitter|x|instagram|youtube|tiktok|crunchbase|wikipedia|glassdoor|indeed|welcometothejungle|pappers|societe|bloomberg|github|medium)\.[a-z.]+$/;
const slugOf = (url: string) => url.split('/in/')[1] ?? url;
const personDomain = (url: string) => `person:${slugOf(url)}`; // employer snapshots live under a per-person key
const RELATION_FR: Record<string, string> = { customer: 'ex-client', partner: 'ex-partenaire', won_deal: 'deal gagné', champion: 'champion' };

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const empty: Output = { checked: 0, baselines: 0, unchanged: 0, moves: [], new_moves: 0, notified: 'none', signals: [] };
    if (!legEnabled(ctx, 'harvestapi')) { ctx.log('HARVESTAPI_API_KEY missing: nothing to check'); return empty; }

    const people = new Map<string, PersonIn>();
    for (const p of input.people) { const u = normalizeLinkedin(p.linkedin_url); if (u) people.set(u, { ...p, linkedin_url: u }); }
    if (input.from_store) {
      for (const p of await ctx.store.listPeople()) {
        const u = normalizeLinkedin(p.linkedinUrl);
        if (!u || !p.domain || people.has(u)) continue;
        const raw = p.raw as Record<string, unknown>;
        const rel = Relation.safeParse(raw.relation);
        people.set(u, { linkedin_url: u, name: [p.firstName, p.lastName].filter(Boolean).join(' ') || undefined, domain: p.domain, company: typeof raw.company === 'string' ? raw.company : undefined, relation: rel.success ? rel.data : undefined });
      }
    }
    const list = [...people.values()].slice(0, input.max_profiles);

    const profMeta: LegMeta = { leg: 'harvestapi_profile', provider: 'harvestapi', tool: 'get_profile', rowsReached: list.length, accepted: 0, receiptIds: [] };
    const exaMeta: LegMeta = { leg: 'exa_company_domain', provider: 'exa', tool: 'search', rowsReached: 0, accepted: 0, receiptIds: [] };
    ctx.metas.push(profMeta, exaMeta);
    const exaOn = legEnabled(ctx, 'exa', 'exa_company_domain');
    const domainCache = new Map<string, string | null>();
    const resolveDomain = async (company: string) => {
      const k = companyKey(company);
      if (domainCache.has(k)) return domainCache.get(k)!;
      let d: string | null = null;
      if (exaOn) {
        exaMeta.rowsReached++;
        const rc = await ctx.runner.execute({ provider: 'exa', tool: 'search', input: { query: `${company} official website`, numResults: 5 }, runId: ctx.runId });
        exaMeta.receiptIds!.push(rc.id);
        if (!rc.cached) ctx.spent.credits += rc.costCredits;
        const hit = ((rc.output as any)?.results ?? []).map((r: any) => apexDomain(r.url)).find((x: string | null) => x && !SOCIAL.test(x));
        if (rc.status === 'hit' && hit) { d = hit; exaMeta.accepted++; }
      }
      domainCache.set(k, d);
      return d;
    };

    const signals: Signal[] = [];
    const moves: Array<Move & { key: string }> = [];
    let baselines = 0, unchanged = 0;
    for (const p of list) {
      const url = p.linkedin_url;
      const rc = await executeFresh(ctx, 'harvestapi', 'get_profile', { url }, input.max_age_days * 86400000);
      profMeta.receiptIds!.push(rc.id);
      if (!rc.cached) ctx.spent.credits += rc.costCredits;
      const prof = (rc.output as any) ?? {};
      const current = typeof prof.company === 'string' ? prof.company.trim() : '';
      if (rc.status !== 'hit' || !current) continue;
      profMeta.accepted++;
      const now = new Date().toISOString();
      const title = prof.title ?? prof.headline ?? null;
      const snapshot = (company: string, domain: string | null): Signal => ({
        dedupeKey: key('person_employer', url, companyKey(company)), domain: personDomain(url), type: 'person_employer', source: 'harvestapi', observedAt: now, receiptId: rc.id,
        value: { person: p.name, linkedin_url: url, company, domain, title, relation: p.relation },
      });

      // Known employer: what the caller says, else the latest snapshot we stored
      let fromCompany = p.company?.trim() || null;
      let fromDomain = apexDomain(p.domain);
      if (!fromCompany && !fromDomain) {
        const last = (await ctx.store.listSignals([personDomain(url)])).filter((s) => s.type === 'person_employer').sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? ''))[0];
        if (!last) { signals.push(snapshot(current, null)); baselines++; continue; } // first sighting: baseline, no alert
        fromCompany = String((last.value as any).company ?? '') || null;
        fromDomain = ((last.value as any).domain as string) ?? null;
      }
      const sameName = fromCompany ? companyKey(fromCompany) === companyKey(current) : fromDomain ? fromDomain.split('.')[0].replace(/[^a-z0-9]/g, '') === companyKey(current) : false;
      if (sameName) { signals.push(snapshot(current, fromDomain)); unchanged++; continue; }
      const toDomain = await resolveDomain(current);
      if (toDomain && fromDomain && toDomain === fromDomain) { signals.push(snapshot(current, toDomain)); unchanged++; continue; } // renamed, same company
      signals.push(snapshot(current, toDomain));
      const jobKey = key('job_change', url, companyKey(current));
      moves.push({ key: jobKey, person: p.name ?? ([prof.firstName, prof.lastName].filter(Boolean).join(' ') || undefined), linkedin_url: url, from_company: fromCompany, from_domain: fromDomain, to_company: current, to_domain: toDomain, new_title: title, relation: p.relation });
      signals.push({
        dedupeKey: jobKey, domain: toDomain ?? `linkedin-company:${companyKey(current)}`, type: 'job_change', source: 'harvestapi', observedAt: now, receiptId: rc.id,
        value: { person: p.name, linkedin_url: url, from_company: fromCompany, from_domain: fromDomain, to_company: current, new_title: title, relation: p.relation },
      });
    }

    const before = new Set((await ctx.store.listSignals([...new Set(signals.map((s) => s.domain))])).map((s) => s.dedupeKey));
    const fresh = moves.filter((m) => !before.has(m.key));
    await ctx.store.upsertSignals(signals);

    let notified: Output['notified'] = 'none';
    if (input.notify && fresh.length) {
      const lines = fresh.slice(0, 10).map((m) => `• ${m.person ?? slugOf(m.linkedin_url)} (${m.relation ? RELATION_FR[m.relation] : 'contact'} chez ${m.from_company ?? m.from_domain ?? '?'}) est maintenant ${m.new_title ?? 'en poste'} chez ${m.to_company}${m.to_domain ? ` (${m.to_domain})` : ''} → écrire ${m.linkedin_url}`);
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`People moves: ${fresh.length} nouveau(x)\n${lines.join('\n')}`);
    }
    ctx.log(`${list.length} checked, ${baselines} baselines, ${unchanged} unchanged, ${moves.length} moves (${fresh.length} new), slack=${notified}`);
    const strip = ({ key: _k, ...m }: Move & { key: string }): Move => m;
    return { checked: list.length, baselines, unchanged, moves: moves.map(strip), new_moves: fresh.length, notified, signals: signals.filter((s) => s.type === 'job_change' && fresh.some((m) => m.key === s.dedupeKey)) };
  },
});
