import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { apexDomain } from '../core/normalize.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta } from '../core/types.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'closed-lost-revival';
export const DESCRIPTION = 'Closed-lost HubSpot deals lost 60–540 days ago: pulls company signals, keeps only those observed after the loss, scores the revival (new funding, integration/partnership hiring, growth, new decision maker) and proposes an angle from the loss reason. Ranked, ready for the revive-closed-lost recipe.';

const DealIn = z.object({
  domain: z.string().min(1),
  lost_reason: z.string().default(''),
  closedate: z.string().min(10).describe('ISO date of the loss'),
  dealname: z.string().optional(),
  amount: z.number().optional(),
});
export const Input = z.object({
  min_days_since_loss: z.number().int().min(0).default(60),
  max_days: z.number().int().min(1).default(540),
  max_accounts: z.number().int().min(1).max(200).default(25),
  pull_signals: z.boolean().default(true).describe('run company-signals per domain (paid); false = only signals already in the store'),
  deals: z.array(DealIn).optional().describe('skip HubSpot and use these lost deals (when the deal → company association is not on the deal)'),
  domain_properties: z.array(z.string()).default(['associated_domain', 'domain', 'company_domain', 'website']).describe('deal properties tried in order to get the company domain'),
  max_pages: z.number().int().min(1).max(50).default(10),
});
export type Input = z.infer<typeof Input>;

export interface RevivalAccount {
  domain: string; dealname: string; amount: number | null; lost_reason: string; closedate: string; days_since_loss: number;
  score: number; tier: 'chaud' | 'tiède' | 'froid'; reasons: string[];
  signals_after_loss: Array<{ type: string; observedAt?: string; summary: string }>;
  angle: string; recipe: 'revive-closed-lost';
}
export interface Output { accounts: RevivalAccount[]; unresolved: Array<{ deal_id: string; dealname: string; reason: string }>; source: 'hubspot' | 'input' | 'none' }

const DAY = 86400000;
const INTEGRATION_JOB = /int[ée]gration|integrations?|partner|partenariat|api|connect|platform|plateforme|ecosystem/i;
const summarize = (s: Signal) => {
  const v = s.value as any;
  if (s.type === 'funding_round') return `levée ${v.round ?? ''} ${v.amount_usd ? `${Math.round(v.amount_usd / 1e6)} M$` : ''}`.trim();
  if (s.type === 'job_opening') return `recrute : ${v.title ?? '?'}`;
  if (s.type === 'headcount_growth') return `effectif +${v.pct} % sur 6 mois`;
  if (s.type === 'job_change') return `nouveau décideur : ${v.name ?? v.person ?? ''} ${v.title ? `(${v.title})` : ''}`.trim();
  return s.type;
};

/** Pure. Points are capped at 100; one strong signal is enough to justify a new conversation. */
export function scoreRevival(signals: Signal[]): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const has = (t: string) => signals.filter((s) => s.type === t);
  if (has('funding_round').length) { score += 40; reasons.push('nouvelle levée'); }
  const jobs = has('job_opening');
  const integ = jobs.filter((s) => INTEGRATION_JOB.test(String((s.value as any).title ?? '')));
  if (integ.length) { score += 25; reasons.push(`recrutement intégration/partenariats (${integ.length})`); }
  if (jobs.length - integ.length > 0) score += Math.min(10, 5 * (jobs.length - integ.length));
  const growth = Math.max(0, ...has('headcount_growth').map((s) => Number((s.value as any).pct) || 0));
  if (growth >= 10) { score += 15; reasons.push(`croissance +${growth} %`); } else if (growth >= 5) { score += 8; reasons.push(`croissance +${growth} %`); }
  if (has('job_change').length) { score += 25; reasons.push('nouveau décideur'); }
  return { score: Math.min(100, score), reasons };
}

/** Pure. The loss reason decides what changed that is worth a new email. */
export function revivalAngle(lostReason: string, top?: string): string {
  const r = lostReason.toLowerCase();
  const sig = top ? ` Accroche : ${top}.` : '';
  if (/in-house|in house|interne|internal|build|en interne|développ/.test(r)) return `Construit en interne : parler du coût de maintenance des connecteurs (changements d'API des logiciels comptables, nouveaux logiciels demandés par les clients, temps dev immobilisé).${sig}`;
  if (/price|prix|budget|cost|co[uû]t|cher|expensive/.test(r)) return `Prix : présenter le nouveau plan / un point d'entrée plus bas, chiffré sur leur volume.${sig}`;
  if (/timing|later|plus tard|priorit|not now|pas le moment|roadmap/.test(r)) return `Timing : le contexte a changé, ouvrir sur le nouveau signal.${sig || ' Chercher un signal avant d\'écrire.'}`;
  if (/codat|merge|apideck|rutter|competitor|concurrent/.test(r)) return `Parti chez un concurrent : couverture des logiciels comptables FR/Benelux et qualité des connecteurs, sans dénigrer.${sig}`;
  if (/no decision|ghost|pas de réponse|unresponsive/.test(r)) return `Pas de décision : nouvel interlocuteur ou nouveau signal, message court.${sig}`;
  return `Motif non classé : ouvrir sur le nouveau signal.${sig}`;
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const now = Date.now();
    const from = now - input.max_days * DAY;
    const to = now - input.min_days_since_loss * DAY;
    const unresolved: Output['unresolved'] = [];
    let lost: Array<z.infer<typeof DealIn> & { id: string }> = [];
    let source: Output['source'] = 'none';

    if (input.deals?.length) {
      source = 'input';
      lost = input.deals.map((d, k) => ({ ...d, id: `input_${k}` }));
    } else if (legEnabled(ctx, 'hubspot')) {
      source = 'hubspot';
      const meta: LegMeta = { leg: 'closed_lost_deals', provider: 'hubspot', tool: 'search_objects', rowsReached: 1, accepted: 0, receiptIds: [] };
      ctx.metas.push(meta);
      let after: string | null = null;
      for (let page = 0; page < input.max_pages; page++) {
        // hs_is_closed + !won covers every pipeline, not just the default "closedlost" stage
        const rc = await ctx.runner.execute({ provider: 'hubspot', tool: 'search_objects', runId: ctx.runId, input: {
          objectType: 'deals',
          filters: [
            { propertyName: 'hs_is_closed', operator: 'EQ', value: 'true' },
            { propertyName: 'hs_is_closed_won', operator: 'EQ', value: 'false' },
            { propertyName: 'closedate', operator: 'GTE', value: String(from) },
            { propertyName: 'closedate', operator: 'LTE', value: String(to) },
          ],
          properties: ['dealname', 'dealstage', 'amount', 'closedate', 'closed_lost_reason', 'hs_is_closed', 'hs_is_closed_won', ...input.domain_properties],
          sorts: [{ propertyName: 'closedate', direction: 'DESCENDING' }], limit: 100, ...(after ? { after } : {}),
        } });
        meta.receiptIds!.push(rc.id);
        if (rc.status !== 'hit') break;
        const out = rc.output as any;
        for (const d of (out?.results ?? []) as Array<{ id: string; properties: Record<string, string> }>) {
          const p = d.properties ?? {};
          const isLost = p.dealstage === 'closedlost' || (p.hs_is_closed === 'true' && p.hs_is_closed_won !== 'true');
          if (!isLost) continue;
          const dom = input.domain_properties.map((k) => apexDomain(p[k])).find(Boolean);
          if (!dom) { unresolved.push({ deal_id: String(d.id), dealname: String(p.dealname ?? ''), reason: 'no_domain_on_deal' }); continue; }
          lost.push({ id: String(d.id), domain: dom, lost_reason: String(p.closed_lost_reason ?? ''), closedate: String(p.closedate ?? ''), dealname: p.dealname, amount: p.amount ? Number(p.amount) : undefined });
        }
        after = out?.next ?? null;
        if (!after) break;
      }
      meta.accepted = lost.length;
    } else {
      ctx.log('HUBSPOT_TOKEN missing and no deals[] given: nothing to revive');
      return { accounts: [], unresolved, source };
    }

    // Window + one row per domain (most recent loss), then cap before any paid call
    const byDomain = new Map<string, (typeof lost)[number]>();
    for (const d of lost) {
      const t = Date.parse(d.closedate);
      const dom = apexDomain(d.domain) ?? d.domain;
      if (!Number.isFinite(t) || t < from || t > to) continue;
      const prev = byDomain.get(dom);
      if (!prev || Date.parse(prev.closedate) < t) byDomain.set(dom, { ...d, domain: dom });
    }
    const picked = [...byDomain.values()].sort((a, b) => Date.parse(b.closedate) - Date.parse(a.closedate)).slice(0, input.max_accounts);

    const accounts: RevivalAccount[] = [];
    for (const d of picked) {
      if (input.pull_signals) await ctx.runPlay('company-signals', { domain: d.domain });
      const lossAt = new Date(d.closedate).toISOString();
      // The store also holds signals from other plays (job_change, LinkedIn); everything after the loss counts
      const after = (await ctx.store.listSignals([d.domain], lossAt)).filter((s) => s.observedAt && s.observedAt > lossAt && s.type !== 'contact_touch')
        .sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
      const { score, reasons } = scoreRevival(after);
      const strongest = after.find((s) => s.type === 'funding_round' || s.type === 'job_change') ?? after.find((s) => s.type === 'job_opening' && INTEGRATION_JOB.test(String((s.value as any).title ?? ''))) ?? after[0];
      accounts.push({
        domain: d.domain, dealname: d.dealname ?? d.domain, amount: d.amount ?? null, lost_reason: d.lost_reason, closedate: lossAt.slice(0, 10),
        days_since_loss: Math.round((now - Date.parse(lossAt)) / DAY), score, tier: score >= 60 ? 'chaud' : score >= 30 ? 'tiède' : 'froid', reasons,
        signals_after_loss: after.slice(0, 10).map((s) => ({ type: s.type, observedAt: s.observedAt, summary: summarize(s) })),
        angle: revivalAngle(d.lost_reason, strongest ? `${summarize(strongest)} (${String(strongest.observedAt).slice(0, 10)})` : undefined), recipe: 'revive-closed-lost',
      });
    }
    accounts.sort((a, b) => b.score - a.score || a.days_since_loss - b.days_since_loss);
    ctx.log(`${lost.length} lost deals, ${picked.length} in window, ${accounts.filter((a) => a.tier === 'chaud').length} chaud, ${unresolved.length} without domain`);
    return { accounts, unresolved, source };
  },
});
