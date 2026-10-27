import { costFromTable, defineAdapter, errorResult, httpJson } from './_adapter.ts';
import { env } from '../config.ts';
import type { ToolDef } from '../core/types.ts';

/**
 * Instantly API v2 (cold email sending). A campaign created through the API starts as a draft
 * (status 0): nothing is sent until someone activates it in Instantly. Writes are never cached.
 */
const BASE = 'https://api.instantly.ai/api/v2'; // verify against docs
const PRICE = {
  create_campaign: { basis: 'free', credits: 0, note: 'included in the Instantly plan' },
  add_leads: { basis: 'free', credits: 0, note: 'included in the Instantly plan; ≤ 1000 per call' },
  campaign_analytics: { basis: 'free', credits: 0 },
  step_analytics: { basis: 'free', credits: 0 },
} as const;

const noCache = (def: ToolDef): ToolDef => ({ ...def, noCache: true });
const headers = () => ({ 'content-type': 'application/json', authorization: `Bearer ${env('INSTANTLY_API_KEY') ?? ''}` });
const ok = (s: number) => s >= 200 && s < 300;

export const instantly = defineAdapter({
  name: 'instantly',
  pricing: { usdPerCredit: 0, verifiedOn: '2026-10-13 (plan-based, no per-call cost)', table: PRICE },
  requiredEnv: ['INSTANTLY_API_KEY'],
  tools: {
    create_campaign: noCache({
      description: 'Create a draft campaign with its steps (subject/body per step, delay in days) and a weekday schedule.',
      normalize: (i) => ({ name: String(i.name ?? ''), steps: Array.isArray(i.steps) ? i.steps : [], timezone: String(i.timezone ?? 'Europe/Paris') }),
      async execute(i, ctx) {
        const steps = (i.steps as Array<{ subject: string; body: string; delay_days?: number }>).map((s, k) => ({ type: 'email', delay: k === 0 ? 0 : Number(s.delay_days ?? 3), variants: [{ subject: s.subject, body: s.body }] }));
        const payload = {
          name: i.name,
          campaign_schedule: { schedules: [{ name: 'Weekdays', timing: { from: '08:30', to: '17:30' }, days: { 1: true, 2: true, 3: true, 4: true, 5: true }, timezone: i.timezone }] },
          sequences: [{ steps }],
        };
        const { status, body } = await httpJson(ctx, `${BASE}/campaigns`, { method: 'POST', headers: headers(), body: JSON.stringify(payload) }); // verify against docs
        if (!ok(status)) return errorResult(status, body, body?.message ?? body?.error);
        return { status: 'hit', output: { id: body?.id, name: body?.name, status: body?.status ?? 0 } };
      },
      cost: costFromTable(PRICE.create_campaign),
    }),
    add_leads: noCache({
      description: 'Add leads to a campaign; duplicates across the workspace are skipped by Instantly.',
      normalize: (i) => ({ campaign_id: String(i.campaign_id ?? ''), leads: (Array.isArray(i.leads) ? i.leads : []).slice(0, 1000) }),
      async execute(i, ctx) {
        if (!(i.leads as unknown[]).length) return { status: 'miss', missReason: 'no_leads', output: {} };
        const payload = { campaign_id: i.campaign_id, skip_if_in_workspace: true, leads: i.leads };
        const { status, body } = await httpJson(ctx, `${BASE}/leads/add`, { method: 'POST', headers: headers(), body: JSON.stringify(payload) }); // verify against docs
        if (!ok(status)) return errorResult(status, body, body?.message ?? body?.error);
        return { status: 'hit', output: { uploaded: body?.leads_uploaded ?? body?.uploaded ?? (i.leads as unknown[]).length, skipped: body?.skipped_count ?? body?.duplicated_leads ?? 0, raw_status: body?.status ?? null } };
      },
      cost: costFromTable(PRICE.add_leads),
    }),
    campaign_analytics: noCache({
      description: 'Per-campaign totals: sent, opened, replied, bounced, positive replies (opportunities).',
      normalize: (i) => ({ ids: (Array.isArray(i.ids) ? i.ids.map(String) : []).sort() }),
      async execute(i, ctx) {
        const qs = new URLSearchParams();
        for (const id of i.ids as string[]) qs.append('ids', id);
        const { status, body } = await httpJson(ctx, `${BASE}/campaigns/analytics?${qs}`, { headers: headers() }); // verify against docs
        if (!ok(status)) return errorResult(status, body, body?.message ?? body?.error);
        const campaigns = ((Array.isArray(body) ? body : body?.items ?? []) as any[]).map((c) => ({
          id: c.campaign_id ?? c.id, name: c.campaign_name ?? c.name, sent: c.emails_sent_count ?? 0, opened: c.open_count_unique ?? c.open_count ?? 0,
          replied: c.reply_count_unique ?? c.reply_count ?? 0, bounced: c.bounced_count ?? 0, opportunities: c.total_opportunities ?? 0, leads: c.leads_count ?? 0,
        }));
        return campaigns.length ? { status: 'hit', output: { campaigns } } : { status: 'miss', missReason: 'no_campaigns', output: { campaigns } };
      },
      cost: costFromTable(PRICE.campaign_analytics),
    }),
    step_analytics: noCache({
      description: 'Per-step (and per-variant) sent / replies for one campaign.',
      normalize: (i) => ({ campaign_id: String(i.campaign_id ?? '') }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/campaigns/analytics/steps?campaign_id=${encodeURIComponent(String(i.campaign_id))}`, { headers: headers() }); // verify against docs
        if (!ok(status)) return errorResult(status, body, body?.message ?? body?.error);
        const steps = ((Array.isArray(body) ? body : body?.items ?? []) as any[]).map((s) => ({ step: Number(s.step ?? 0), variant: String(s.variant ?? 'A'), sent: s.sent ?? 0, opened: s.unique_opened ?? s.opened ?? 0, replied: s.unique_replies ?? s.replies ?? 0, opportunities: s.opportunities ?? 0 }));
        return steps.length ? { status: 'hit', output: { steps } } : { status: 'miss', missReason: 'no_steps', output: { steps } };
      },
      cost: costFromTable(PRICE.step_analytics),
    }),
  },
});
