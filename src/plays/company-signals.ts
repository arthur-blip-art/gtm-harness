import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { apexDomain } from '../core/normalize.ts';
import { sha256 } from '../core/hash.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta, RowState } from '../core/types.ts';
import type { Signal } from '../store/store.ts';
import { BatchInput, type BatchOutput } from '../core/row-play.ts';

export const NAME = 'company-signals';
export const DESCRIPTION = 'Funding rounds, job openings and headcount growth for a domain → signals table (idempotent by dedupe key). All sources run; no early stop.';

export const Input = z.object({ domain: z.string().min(1), job_days: z.number().int().min(1).max(180).default(90) });
export type Input = z.infer<typeof Input>;
export interface Output { domain: string; signals: Signal[]; inserted: number; sources: Record<string, string> }

const key = (domain: string, type: string, source: string, ref: string) => sha256(`${domain}|${type}|${source}|${ref}`).slice(0, 32);
const day = (d: unknown) => (typeof d === 'string' && d.length >= 10 ? (d.length === 10 ? `${d}T00:00:00Z` : d) : undefined);

export async function pullSignals(domainRaw: string, jobDays: number, ctx: PlayCtx): Promise<Output> {
  const domain = apexDomain(domainRaw) ?? domainRaw;
  const signals: Signal[] = [];
  const sources: Record<string, string> = {};
  const run = async (id: string, provider: string, tool: string, input: Record<string, unknown>, map: (o: any, receiptId: string) => Signal[]) => {
    const meta: LegMeta = { leg: id, provider, tool, rowsReached: 0, accepted: 0, receiptIds: [] };
    ctx.metas.push(meta);
    if (!legEnabled(ctx, provider, id)) { sources[id] = 'skipped'; return; }
    meta.rowsReached = 1;
    const rc = await ctx.runner.execute({ provider, tool, input, runId: ctx.runId });
    meta.receiptIds!.push(rc.id);
    if (!rc.cached) ctx.spent.credits += rc.costCredits;
    sources[id] = rc.status;
    if (rc.status !== 'hit') return;
    const found = map(rc.output, rc.id);
    meta.accepted = found.length;
    signals.push(...found);
  };
  await run('predictleads_funding', 'predictleads', 'financing_events', { domain }, (o, rid) => ((o?.events ?? []) as any[]).map((e) => ({
    dedupeKey: key(domain, 'funding_round', 'predictleads', `${e.date}|${e.financing_type}|${e.amount}`), domain, type: 'funding_round', source: 'predictleads',
    value: { amount_usd: e.amount, currency: e.currency, round: e.financing_type, url: e.url ?? e.article_url }, observedAt: day(e.date), receiptId: rid,
  })));
  await run('predictleads_jobs', 'predictleads', 'job_openings', { domain }, (o, rid) => ((o?.jobs ?? []) as any[]).map((j) => ({
    dedupeKey: key(domain, 'job_opening', 'predictleads', j.url ?? `${j.title}|${j.first_seen_at}`), domain, type: 'job_opening', source: 'predictleads',
    value: { title: j.title, url: j.url, categories: j.categories }, observedAt: day(j.first_seen_at), receiptId: rid,
  })));
  await run('theirstack_jobs', 'theirstack', 'job_search', { company_domain_or: [domain], posted_at_max_age_days: jobDays, limit: 25, page: 0, include_total_results: true }, (o, rid) => ((o?.jobs ?? o?.results ?? []) as any[]).map((j) => ({
    dedupeKey: key(domain, 'job_opening', 'theirstack', j.url ?? `${j.job_title}|${j.date_posted}`), domain, type: 'job_opening', source: 'theirstack',
    value: { title: j.job_title, url: j.url, location: j.location }, observedAt: day(j.date_posted), receiptId: rid,
  })));
  await run('crustdata_headcount', 'crustdata', 'company_enrich', { domain }, (o, rid) => {
    const pct = o?.headcount_growth_6m_pct ?? o?.headcount?.linkedin_headcount_total_growth_percent?.six_months ?? o?.headcount?.linkedin_headcount_total_growth_percent;
    const month = new Date().toISOString().slice(0, 7);
    return typeof pct === 'number' ? [{ dedupeKey: key(domain, 'headcount_growth', 'crustdata', month), domain, type: 'headcount_growth', source: 'crustdata', value: { pct, headcount: o?.headcount?.linkedin_headcount ?? o?.headcount }, observedAt: `${month}-01T00:00:00Z`, receiptId: rid }] : [];
  });
  const inserted = await ctx.store.upsertSignals(signals);
  return { domain, signals, inserted, sources };
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  run: (input, ctx) => pullSignals(input.domain, input.job_days, ctx),
});

export const batch = definePlay<BatchInput, BatchOutput>({
  name: `${NAME}:batch`, description: `${DESCRIPTION} (batch over a domain column)`, kind: 'batch', input: BatchInput,
  async run(input, ctx) {
    const { datasetId, rows } = await ctx
      .dataset(input.rows, { slug: input.slug, rowKey: (r) => `co:${apexDomain(r.domain) ?? r.domain}` })
      .withColumn('signals', async (row: RowState) => (row.input.domain ? (await pullSignals(row.input.domain, 90, ctx)) : { status: 'skipped', missReason: 'missing_domain' }), { concurrency: 2 })
      .run();
    return { rows, field: 'signals', legIds: [], datasetId };
  },
});
