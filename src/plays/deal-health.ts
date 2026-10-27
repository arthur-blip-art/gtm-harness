import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { createNotifier } from '../core/notify.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta } from '../core/types.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'deal-health';
export const DESCRIPTION = 'Open HubSpot deals checked for missing next step, missing or past close date, no activity for stale_days, age over 120 days. Scores healthy / watch / critical, Slack digest of newly critical deals, sorted output. Writes to HubSpot only with write: true.';

export const Input = z.object({
  stale_days: z.number().int().min(1).max(365).default(21).describe('no activity for this many days = stale'),
  max_age_days: z.number().int().min(1).default(120),
  notify: z.boolean().default(true),
  write: z.boolean().default(false).describe('write gtm_deal_health / gtm_deal_health_reasons on each deal (custom properties that must exist in HubSpot)'),
  max_pages: z.number().int().min(1).max(50).default(10),
});
export type Input = z.infer<typeof Input>;

export type Health = 'sain' | 'à surveiller' | 'critique';
export interface DealHealth { id: string; dealname: string; dealstage: string; amount: number | null; closedate: string | null; health: Health; score: number; problems: string[]; days_since_activity: number | null; age_days: number | null }
export interface Output { deals: DealHealth[]; counts: Record<Health, number>; notified: 'sent' | 'skipped' | 'failed' | 'none'; written: number }

const PROPS = ['dealname', 'dealstage', 'amount', 'closedate', 'hs_next_step', 'notes_last_updated', 'hs_lastmodifieddate', 'createdate', 'hs_is_closed'];
const daysSince = (d: unknown, now: number) => { const t = Date.parse(String(d ?? '')); return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null; };
const RANK: Record<Health, number> = { critique: 0, 'à surveiller': 1, sain: 2 };

/** Pure. Weights: stale and past close date weigh 2, the rest 1. 0 = sain, 1–2 = à surveiller, ≥ 3 = critique. */
export function assessDeal(id: string, p: Record<string, string | null | undefined>, opts: { stale_days: number; max_age_days: number }, now = Date.now()): DealHealth {
  const problems: string[] = [];
  let score = 0;
  const add = (w: number, msg: string) => { score += w; problems.push(msg); };
  if (!String(p.hs_next_step ?? '').trim()) add(1, 'pas de next step');
  const close = Date.parse(String(p.closedate ?? ''));
  if (!Number.isFinite(close)) add(1, 'close date absente');
  else if (close < now) add(2, `close date dépassée (${String(p.closedate).slice(0, 10)})`);
  const activity = daysSince(p.notes_last_updated || p.hs_lastmodifieddate, now);
  if (activity === null || activity >= opts.stale_days) add(2, activity === null ? 'aucune activité enregistrée' : `aucune activité depuis ${activity} j`);
  const age = daysSince(p.createdate, now);
  if (age !== null && age > opts.max_age_days) add(1, `deal ouvert depuis ${age} j`);
  const health: Health = score >= 3 ? 'critique' : score >= 1 ? 'à surveiller' : 'sain';
  const amount = Number(p.amount);
  return { id, dealname: String(p.dealname ?? id), dealstage: String(p.dealstage ?? ''), amount: p.amount && Number.isFinite(amount) ? amount : null, closedate: p.closedate || null, health, score, problems, days_since_activity: activity, age_days: age };
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const empty: Output = { deals: [], counts: { sain: 0, 'à surveiller': 0, critique: 0 }, notified: 'none', written: 0 };
    if (!legEnabled(ctx, 'hubspot')) { ctx.log('HUBSPOT_TOKEN missing: nothing to read'); return empty; }
    const meta: LegMeta = { leg: 'open_deals', provider: 'hubspot', tool: 'search_objects', rowsReached: 1, accepted: 0, receiptIds: [] };
    ctx.metas.push(meta);
    const raw: Array<{ id: string; properties: Record<string, string> }> = [];
    let after: string | null = null;
    for (let page = 0; page < input.max_pages; page++) {
      const rc = await ctx.runner.execute({ provider: 'hubspot', tool: 'search_objects', runId: ctx.runId, input: {
        objectType: 'deals', filters: [{ propertyName: 'hs_is_closed', operator: 'EQ', value: 'false' }], properties: PROPS, limit: 100, ...(after ? { after } : {}),
      } });
      meta.receiptIds!.push(rc.id);
      if (rc.status !== 'hit') break;
      const out = rc.output as any;
      raw.push(...(out?.results ?? []));
      after = out?.next ?? null;
      if (!after) break;
    }
    // Filter again client-side: the server filter is the contract, this is the guarantee
    const now = Date.now();
    const deals = raw.filter((d) => String(d.properties?.hs_is_closed ?? 'false') !== 'true')
      .map((d) => assessDeal(String(d.id), d.properties ?? {}, input, now))
      .sort((a, b) => RANK[a.health] - RANK[b.health] || b.score - a.score || (b.amount ?? 0) - (a.amount ?? 0));
    meta.accepted = deals.length;
    const counts = { sain: 0, 'à surveiller': 0, critique: 0 } as Record<Health, number>;
    for (const d of deals) counts[d.health]++;

    // Alert once per deal per week while it stays critical
    const week = new Date(now - ((new Date(now).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    const critical = deals.filter((d) => d.health === 'critique');
    const signals: Signal[] = critical.map((d) => ({
      dedupeKey: sha256(`deal_health|${d.id}|critique|${week}`).slice(0, 32), domain: `hubspot-deal:${d.id}`, type: 'deal_health', source: 'hubspot',
      observedAt: new Date(now).toISOString(), receiptId: meta.receiptIds![0], value: { ...d, week },
    }));
    const before = new Set((await ctx.store.listSignals(signals.map((s) => s.domain))).map((s) => s.dedupeKey));
    const fresh = signals.filter((s) => !before.has(s.dedupeKey));
    await ctx.store.upsertSignals(signals);
    let notified: Output['notified'] = 'none';
    if (input.notify && fresh.length) {
      const lines = fresh.slice(0, 10).map((s) => { const d = s.value as unknown as DealHealth; return `• ${d.dealname}${d.amount ? ` (${d.amount} €)` : ''} : ${d.problems.join(', ')}`; });
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`Deals critiques : ${fresh.length} nouveaux (${critical.length} au total)\n${lines.join('\n')}`);
    }

    let written = 0;
    if (input.write) {
      const wmeta: LegMeta = { leg: 'write_health', provider: 'hubspot', tool: 'update', rowsReached: deals.length, accepted: 0, receiptIds: [] };
      ctx.metas.push(wmeta);
      for (const d of deals) {
        const rc = await ctx.runner.execute({ provider: 'hubspot', tool: 'update', runId: ctx.runId, input: { objectType: 'deals', id: d.id, properties: { gtm_deal_health: d.health, gtm_deal_health_reasons: d.problems.join('; ') } } });
        wmeta.receiptIds!.push(rc.id);
        if (rc.status === 'hit') written++;
      }
      wmeta.accepted = written;
    }
    ctx.log(`${deals.length} open deals: ${counts.critique} critique, ${counts['à surveiller']} à surveiller, ${counts.sain} sain; slack=${notified}${input.write ? `, ${written} written` : ''}`);
    return { deals, counts, notified, written };
  },
});
