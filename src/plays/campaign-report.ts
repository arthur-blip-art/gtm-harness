import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { createNotifier } from '../core/notify.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta } from '../core/types.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'campaign-report';
export const DESCRIPTION = 'Instantly campaign report: reply, positive-reply (opportunity) and bounce rates per campaign, verdicts (list to re-verify, angle to rework), winning variant per step. Opens are never used. Weekly campaign_stats signals + Slack digest.';

export const Input = z.object({
  campaign_ids: z.array(z.string().min(1)).min(1).describe('Instantly campaign ids'),
  min_sent: z.number().int().min(1).default(50).describe('no verdict below this many emails sent (campaign or variant)'),
  notify: z.boolean().default(true),
});
export type Input = z.infer<typeof Input>;

export interface CampaignStats { id: string; name: string; sent: number; replied: number; opportunities: number; bounced: number }
export interface StepStats { step: number; variant: string; sent: number; replied: number; opportunities: number }
export interface CampaignVerdict {
  id: string; name: string; sent: number;
  reply_rate: number | null; opportunity_rate: number | null; bounce_rate: number | null;
  verdicts: string[];
  winners: Array<{ step: number; variant: string; opportunity_rate: number; reply_rate: number; over: string[] }>;
}
export interface Output { campaigns: CampaignVerdict[]; new_signals: number; notified: 'sent' | 'skipped' | 'failed' | 'none' }

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 10000 : null);
const pct = (r: number | null) => (r === null ? 'n/a' : `${(r * 100).toFixed(1)} %`);
const isoWeek = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const w = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
};

/** Pure: thresholds live here so they are testable without Instantly. */
export function assessCampaign(c: CampaignStats, steps: StepStats[], minSent: number): CampaignVerdict {
  const reply = rate(c.replied, c.sent);
  const bounce = rate(c.bounced, c.sent);
  const verdicts: string[] = [];
  if (c.sent < minSent) verdicts.push(`pas assez d'envois (${c.sent} < ${minSent}) : pas de verdict`);
  else {
    if (bounce !== null && bounce > 0.03) verdicts.push('liste à revérifier');
    if (reply !== null && reply < 0.01) verdicts.push('angle ou ciblage à revoir');
  }
  // Winner per step: positive replies first, then replies; only among variants with enough volume
  const winners: CampaignVerdict['winners'] = [];
  const byStep = new Map<number, StepStats[]>();
  for (const s of steps) (byStep.get(s.step) ?? byStep.set(s.step, []).get(s.step)!).push(s);
  for (const [step, vs] of [...byStep].sort((a, b) => a[0] - b[0])) {
    const eligible = vs.filter((v) => v.sent >= minSent).map((v) => ({ ...v, opp: rate(v.opportunities, v.sent) ?? 0, rep: rate(v.replied, v.sent) ?? 0 }));
    if (eligible.length < 2) continue;
    eligible.sort((a, b) => b.opp - a.opp || b.rep - a.rep);
    const [w, next] = eligible;
    if (w.opp === next.opp && w.rep === next.rep) continue; // tie: no winner
    winners.push({ step: step + 1, variant: w.variant, opportunity_rate: w.opp, reply_rate: w.rep, over: eligible.slice(1).map((v) => v.variant) });
  }
  return { id: c.id, name: c.name, sent: c.sent, reply_rate: reply, opportunity_rate: rate(c.opportunities, c.sent), bounce_rate: bounce, verdicts, winners };
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    if (!legEnabled(ctx, 'instantly')) {
      ctx.log('INSTANTLY_API_KEY missing: nothing to report (use --dry-run to exercise the flow)');
      return { campaigns: [], new_signals: 0, notified: 'none' };
    }
    const call = async (leg: string, tool: string, inp: Record<string, unknown>) => {
      const meta: LegMeta = { leg, provider: 'instantly', tool, rowsReached: 1, accepted: 0, receiptIds: [] };
      ctx.metas.push(meta);
      const rc = await ctx.runner.execute({ provider: 'instantly', tool, input: inp, runId: ctx.runId });
      meta.receiptIds!.push(rc.id);
      if (!rc.cached) ctx.spent.credits += rc.costCredits;
      if (rc.status === 'hit') meta.accepted = 1;
      return rc;
    };
    const totals = await call('campaign_analytics', 'campaign_analytics', { ids: input.campaign_ids });
    const rows = (((totals.output as any)?.campaigns ?? []) as any[]).filter((c) => input.campaign_ids.includes(String(c.id)));
    const week = isoWeek();
    const campaigns: CampaignVerdict[] = [];
    const signals: Signal[] = [];
    for (const c of rows) {
      const id = String(c.id);
      const stepsRc = await call(`step_analytics:${id}`, 'step_analytics', { campaign_id: id });
      const steps: StepStats[] = (((stepsRc.output as any)?.steps ?? []) as any[]).map((s) => ({ step: Number(s.step ?? 0), variant: String(s.variant ?? 'A'), sent: Number(s.sent ?? 0), replied: Number(s.replied ?? 0), opportunities: Number(s.opportunities ?? 0) }));
      const v = assessCampaign({ id, name: String(c.name ?? id), sent: Number(c.sent ?? 0), replied: Number(c.replied ?? 0), opportunities: Number(c.opportunities ?? 0), bounced: Number(c.bounced ?? 0) }, steps, input.min_sent);
      campaigns.push(v);
      signals.push({
        dedupeKey: sha256(`campaign_stats|${id}|${week}`).slice(0, 32), domain: `instantly:${id}`, type: 'campaign_stats', source: 'instantly',
        observedAt: new Date().toISOString(), receiptId: totals.id, value: { week, ...v },
      });
    }
    const before = new Set((await ctx.store.listSignals(signals.map((s) => s.domain))).map((s) => s.dedupeKey));
    const fresh = signals.filter((s) => !before.has(s.dedupeKey));
    await ctx.store.upsertSignals(signals); // same week → overwrite the snapshot, no new alert

    let notified: Output['notified'] = 'none';
    if (input.notify && fresh.length) {
      const lines = campaigns.slice(0, 10).map((c) => {
        const win = c.winners.map((w) => `étape ${w.step} → ${w.variant}`).join(', ');
        return `• ${c.name} : ${c.sent} envoyés, réponse ${pct(c.reply_rate)}, positives ${pct(c.opportunity_rate)}, bounce ${pct(c.bounce_rate)}${c.verdicts.length ? ` — ${c.verdicts.join(' ; ')}` : ''}${win ? ` — gagnant : ${win}` : ''}`;
      });
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`Campagnes Instantly (${week}) : ${campaigns.length}\n${lines.join('\n')}`);
    }
    ctx.log(`${campaigns.length} campaigns, ${campaigns.filter((c) => c.verdicts.length).length} with a verdict, slack=${notified}`);
    return { campaigns, new_signals: fresh.length, notified };
  },
});
