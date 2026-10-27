import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { apexDomain, emailDomain, normalizeEmail, normalizeLinkedin } from '../core/normalize.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta } from '../core/types.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'suppress';
export const DESCRIPTION = 'Drop people who must not be sequenced: HubSpot customer/partner/open deal at their company, contacted or touched by the harness within the cooldown, opted out. Returns kept and dropped rows with a reason. Free.';

/** Who we never write to cold, whatever the signal. Order matters: the first reason found is the one logged. */
export type SuppressReason = 'customer' | 'partner' | 'open_deal' | 'opted_out' | 'recently_contacted' | 'recently_touched' | 'no_identity' | 'hubspot_unavailable';

export interface Person { email?: string; domain?: string; linkedin_url?: string; [k: string]: unknown }
export interface SuppressResult<T extends Person = Person> { kept: T[]; dropped: Array<T & { suppress_reason: SuppressReason; suppress_detail?: string }> }

export const Input = z.object({
  people: z.array(z.record(z.string(), z.unknown())).min(1).describe('rows with email and/or domain and/or linkedin_url'),
  cooldown_days: z.number().int().min(0).max(365).default(84),
  check_hubspot: z.boolean().default(true),
});
export type Input = z.infer<typeof Input>;

const TOUCH = 'contact_touch';
const touchKey = (id: string, channel: string, campaign: string) => sha256(`${TOUCH}|${id}|${channel}|${campaign}`).slice(0, 32);
const identity = (p: Person) => normalizeEmail(p.email) ?? normalizeLinkedin(p.linkedin_url) ?? null;
const domainOf = (p: Person) => apexDomain(p.domain) ?? (p.email ? emailDomain(String(p.email)) : null);

/**
 * The step every sequence goes through before anything is pushed to a sender. HubSpot is read live
 * (never cached); the harness's own touches live in the signals table as `contact_touch`.
 */
export async function suppressPeople<T extends Person>(rows: T[], ctx: PlayCtx, opts: { cooldown_days?: number; check_hubspot?: boolean } = {}): Promise<SuppressResult<T>> {
  const cooldown = opts.cooldown_days ?? 84;
  const since = new Date(Date.now() - cooldown * 86400000).toISOString();
  const hubspot = (opts.check_hubspot ?? true) && legEnabled(ctx, 'hubspot');
  if ((opts.check_hubspot ?? true) && !hubspot) ctx.log('suppress: WARNING HubSpot check requested but HUBSPOT_TOKEN is missing; only local touches are checked (customers, open deals and opt-outs are NOT excluded)');
  const meta: LegMeta = { leg: 'suppress', provider: hubspot ? 'hubspot' : 'local', tool: hubspot ? 'search_objects' : 'signals', rowsReached: rows.length, accepted: 0, receiptIds: [] };
  ctx.metas.push(meta);

  const domains = [...new Set(rows.map(domainOf).filter((d): d is string => !!d))];
  const touches = await ctx.store.listSignals(domains, since);
  const touched = new Map<string, Signal>();
  for (const s of touches) if (s.type === TOUCH) touched.set(String((s.value as any).id), s);

  const search = async (objectType: string, propertyName: string, value: string, properties: string[]) => {
    const rc = await ctx.runner.execute({ provider: 'hubspot', tool: 'search_objects', input: { objectType, filters: [{ propertyName, operator: 'EQ', value }], properties, limit: 1 }, runId: ctx.runId });
    meta.receiptIds!.push(rc.id);
    if (rc.status === 'error') return 'error' as const; // fail closed: an unreadable CRM never lets a lead through
    return rc.status === 'hit' ? ((rc.output as any)?.results?.[0]?.properties ?? {}) as Record<string, string> : null;
  };
  const companyState = new Map<string, Record<string, string> | null | 'error'>();
  const kept: T[] = [];
  const dropped: SuppressResult<T>['dropped'] = [];
  const drop = (p: T, reason: SuppressReason, detail?: string) => dropped.push({ ...p, suppress_reason: reason, ...(detail ? { suppress_detail: detail } : {}) });

  for (const p of rows) {
    const id = identity(p);
    const domain = domainOf(p);
    if (!id && !domain) { drop(p, 'no_identity'); continue; }
    if (hubspot && domain) {
      if (!companyState.has(domain)) companyState.set(domain, await search('companies', 'domain', domain, ['domain', 'lifecyclestage', 'hs_num_open_deals']));
      const co = companyState.get(domain);
      if (co === 'error') { drop(p, 'hubspot_unavailable', domain); continue; }
      const stage = String(co?.lifecyclestage ?? '').toLowerCase();
      if (stage === 'customer') { drop(p, 'customer', domain); continue; }
      if (stage === 'partner' || stage === 'evangelist') { drop(p, 'partner', domain); continue; }
      if (Number(co?.hs_num_open_deals ?? 0) > 0) { drop(p, 'open_deal', domain); continue; }
    }
    const email = normalizeEmail(p.email);
    if (hubspot && email) {
      const c = await search('contacts', 'email', email, ['email', 'hs_email_optout', 'notes_last_contacted', 'hs_last_sales_activity_timestamp']);
      if (c === 'error') { drop(p, 'hubspot_unavailable', email); continue; }
      if (String(c?.hs_email_optout ?? '') === 'true') { drop(p, 'opted_out'); continue; }
      const last = c?.notes_last_contacted || c?.hs_last_sales_activity_timestamp;
      if (last && Date.parse(last) >= Date.parse(since)) { drop(p, 'recently_contacted', String(last).slice(0, 10)); continue; }
    }
    const t = id ? touched.get(id) : undefined;
    if (t) { drop(p, 'recently_touched', `${(t.value as any).channel}:${(t.value as any).campaign} ${String(t.observedAt ?? '').slice(0, 10)}`); continue; }
    kept.push(p);
  }
  meta.accepted = kept.length;
  ctx.log(`suppress: ${kept.length} kept, ${dropped.length} dropped (${Object.entries(countBy(dropped.map((d) => d.suppress_reason))).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'})`);
  return { kept, dropped };
}

/** Record that the harness pushed these people somewhere, so the next play's suppress sees them. */
export async function recordTouches(rows: Person[], ctx: PlayCtx, touch: { channel: string; campaign: string }): Promise<number> {
  const now = new Date().toISOString();
  const signals: Signal[] = [];
  for (const p of rows) {
    const id = identity(p);
    const domain = domainOf(p);
    if (!id || !domain) continue;
    signals.push({ dedupeKey: touchKey(id, touch.channel, touch.campaign), domain, type: TOUCH, source: 'harness', observedAt: now, value: { id, channel: touch.channel, campaign: touch.campaign } });
  }
  return ctx.store.upsertSignals(signals); // dry-run writes to the in-memory store only
}

const countBy = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});

export const play = definePlay<Input, SuppressResult>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  run: (input, ctx) => suppressPeople(input.people as Person[], ctx, input),
});
