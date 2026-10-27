import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { apexDomain, emailDomain, normalizeEmail } from '../core/normalize.ts';
import { legEnabled } from './name-domain-to-email.ts';
import { recordTouches, suppressPeople } from './suppress.ts';
import type { LegMeta, Receipt } from '../core/types.ts';

export const NAME = 'push-sequencer';
export const DESCRIPTION = 'Push a written sequence (steps + leads) to Instantly as a DRAFT campaign: drops LOW/HOLD and suppressed leads, checks every {{variable}} per lead, lints the copy, records touches. Never activates. dry_run_only (default) computes everything without calling Instantly.';

const Step = z.object({
  subject: z.string().default('').describe('empty on a follow-up = reply in the same thread'),
  body: z.string().min(1),
  delay_days: z.number().int().min(0).max(60).default(3).describe('days after the previous step (ignored on step 1)'),
});
const Lead = z.object({
  email: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company: z.string().optional(),
  domain: z.string().optional(),
  title: z.string().optional(),
  confidence: z.string().optional().describe('HIGH | MEDIUM | LOW | HOLD from the email policy; LOW and HOLD are never pushed'),
  variables: z.record(z.string(), z.string()).default({}).describe('per-lead custom variables used in the copy, e.g. {"pain_line": "..."}'),
});
export const Input = z.object({
  campaign: z.string().min(1).describe('Instantly campaign name, e.g. "2026-10 getmoss.com — Pennylane"'),
  steps: z.array(Step).min(1).max(10),
  leads: z.array(Lead).min(1),
  cooldown_days: z.number().int().min(0).max(365).default(84),
  check_hubspot: z.boolean().default(true),
  dry_run_only: z.boolean().default(true).describe('true: compute kept/rejected/warnings, never call Instantly'),
});
export type Input = z.infer<typeof Input>;
type LeadIn = z.infer<typeof Lead>;
export interface Output { campaign_id: string | null; pushed: number; ready: number; dry_run_only: boolean; rejected: Array<{ email: string; reason: string }>; warnings: string[]; touches_recorded: number }

const VAR = /\{\{\s*([A-Za-z_][\w.]*)\s*(?:\|[^}]*)?\}\}/g;
// Filled by Instantly itself (sender, signature, spintax), never by the lead row
const SYSTEM_VARS = new Set(['sendingAccountFirstName', 'sendingAccountLastName', 'sendingAccountFullName', 'accountSignature', 'signature', 'RANDOM', 'unsubscribe', 'unsubscribeLink']);
const ALIASES: Record<string, keyof LeadIn> = { firstName: 'first_name', lastName: 'last_name', companyName: 'company', website: 'domain', jobTitle: 'title' };

export const variablesOf = (text: string) => [...text.matchAll(VAR)].map((m) => m[1]);
const why = (rc: Receipt) => rc.error ?? (rc as Receipt & { missReason?: string }).missReason ?? rc.status;
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|fr|eu|be|nl|co|ai|app)\/\S*/i;
const ATTACHMENT = /pi[eè]ce[s]? jointe|ci-joint|en pj\b|\battached\b|\battachment\b|\.(pdf|docx?|pptx?|xlsx?)\b/i;

/** Copy lint, warnings only: the author decides. Step 1 carries the deliverability constraints. */
export function lintSteps(steps: Input['steps']): string[] {
  const w: string[] = [];
  steps.forEach((s, k) => {
    const n = k + 1;
    if (s.subject.length > 60) w.push(`step ${n}: subject is ${s.subject.length} chars (> 60)`);
    if (n === 1 && !s.subject.trim()) w.push('step 1: empty subject');
    if (n === 1 && words(s.body) > 120) w.push(`step 1: body is ${words(s.body)} words (> 120)`);
    if (n === 1 && LINK.test(s.body)) w.push('step 1: contains a link (hurts deliverability on a first touch)');
    if (ATTACHMENT.test(`${s.subject}\n${s.body}`)) w.push(`step ${n}: mentions an attachment (cold emails go without one)`);
  });
  return w;
}

const leadValue = (l: LeadIn, v: string): string | undefined => {
  const alias = ALIASES[v];
  const raw = l.variables[v] ?? (alias ? (l[alias] as string | undefined) : (l as Record<string, unknown>)[v] as string | undefined);
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
};

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const rejected: Output['rejected'] = [];
    const warnings = lintSteps(input.steps);
    const used = [...new Set(input.steps.flatMap((s) => variablesOf(`${s.subject}\n${s.body}`)))].filter((v) => !SYSTEM_VARS.has(v));

    // 1. identity + confidence gate, dedupe by email
    const seen = new Set<string>();
    const gated: Array<LeadIn & { email: string; domain: string }> = [];
    for (const l of input.leads) {
      const email = normalizeEmail(l.email);
      if (!email) { rejected.push({ email: l.email ?? '', reason: 'no_email' }); continue; }
      const conf = String(l.confidence ?? '').toUpperCase();
      if (conf === 'LOW' || conf === 'HOLD') { rejected.push({ email, reason: `confidence:${conf}` }); continue; }
      if (seen.has(email)) { rejected.push({ email, reason: 'duplicate' }); continue; }
      seen.add(email);
      gated.push({ ...l, email, domain: apexDomain(l.domain) ?? emailDomain(email) ?? '' });
    }

    // 2. suppression (HubSpot + harness touches)
    const sup = gated.length ? await suppressPeople(gated, ctx, { cooldown_days: input.cooldown_days, check_hubspot: input.check_hubspot }) : { kept: [], dropped: [] };
    for (const d of sup.dropped) rejected.push({ email: d.email, reason: `suppressed:${d.suppress_reason}${d.suppress_detail ? ` (${d.suppress_detail})` : ''}` });

    // 3. every variable used in the copy must resolve for the lead, or the email ships with a blank
    const kept = sup.kept.filter((l) => {
      const missing = used.find((v) => leadValue(l, v) === undefined);
      if (missing) rejected.push({ email: l.email, reason: `missing_variable:${missing}` });
      return !missing;
    });
    if (!kept.length) warnings.push('no lead left to push');
    ctx.log(`${kept.length} ready, ${rejected.length} rejected, ${warnings.length} copy warnings`);
    if (input.dry_run_only || !kept.length) return { campaign_id: null, pushed: 0, ready: kept.length, dry_run_only: input.dry_run_only, rejected, warnings, touches_recorded: 0 };

    // 4. draft campaign + leads; activation stays a human click in Instantly
    if (!legEnabled(ctx, 'instantly')) {
      warnings.push('INSTANTLY_API_KEY missing: nothing pushed');
      return { campaign_id: null, pushed: 0, ready: kept.length, dry_run_only: false, rejected, warnings, touches_recorded: 0 };
    }
    const call = async (leg: string, tool: string, inp: Record<string, unknown>, rows: number) => {
      const meta: LegMeta = { leg, provider: 'instantly', tool, rowsReached: rows, accepted: 0, receiptIds: [] };
      ctx.metas.push(meta);
      const rc = await ctx.runner.execute({ provider: 'instantly', tool, input: inp, runId: ctx.runId });
      meta.receiptIds!.push(rc.id);
      if (!rc.cached) ctx.spent.credits += rc.costCredits;
      return { rc, meta };
    };
    const { rc: camp, meta: campMeta } = await call('create_campaign', 'create_campaign', { name: input.campaign, steps: input.steps }, 1);
    const campaignId = camp.status === 'hit' ? String((camp.output as any)?.id ?? '') || null : null;
    if (!campaignId) {
      warnings.push(`create_campaign failed: ${why(camp)}`);
      return { campaign_id: null, pushed: 0, ready: kept.length, dry_run_only: false, rejected, warnings, touches_recorded: 0 };
    }
    campMeta.accepted = 1;
    let pushed = 0;
    const pushedRows: typeof kept = [];
    for (let i = 0; i < kept.length; i += 1000) {
      const chunk = kept.slice(i, i + 1000);
      const leads = chunk.map((l) => ({
        email: l.email, first_name: l.first_name ?? '', last_name: l.last_name ?? '', company_name: l.company ?? '', website: l.domain,
        custom_variables: { ...l.variables, ...(l.title ? { title: l.title } : {}), ...(l.company ? { company: l.company } : {}) },
      }));
      const { rc, meta } = await call(`add_leads:${i / 1000 + 1}`, 'add_leads', { campaign_id: campaignId, leads }, chunk.length);
      if (rc.status !== 'hit') { warnings.push(`add_leads batch ${i / 1000 + 1} failed: ${why(rc)}`); continue; }
      meta.accepted = Number((rc.output as any)?.uploaded ?? chunk.length);
      pushed += meta.accepted;
      const skipped = Number((rc.output as any)?.skipped ?? 0);
      if (skipped) warnings.push(`add_leads batch ${i / 1000 + 1}: ${skipped} skipped by Instantly (already in workspace)`);
      pushedRows.push(...chunk);
    }
    const touches = await recordTouches(pushedRows, ctx, { channel: 'instantly', campaign: input.campaign });
    ctx.log(`draft campaign ${campaignId}: ${pushed} leads pushed, not activated`);
    return { campaign_id: campaignId, pushed, ready: kept.length, dry_run_only: false, rejected, warnings, touches_recorded: touches };
  },
});
