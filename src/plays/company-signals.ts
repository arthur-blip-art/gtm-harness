import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { apexDomain } from '../core/normalize.ts';
import { sha256 } from '../core/hash.ts';
import { callLeg, canRun } from '../core/leg.ts';
import { atsJobs, companyNews, jobSignals, newsSignals, readSite } from '../core/site.ts';
import type { Signal } from '../store/store.ts';
import { BatchInput, type BatchOutput } from '../core/row-play.ts';
import type { RowState } from '../core/types.ts';

export const NAME = 'company-signals';
export const DESCRIPTION = 'Situation and timing for a domain, free sources first: open jobs from its own ATS board, dated news (funding, new executive, launch, expansion), SEC Form D (US funding), BODACC (FR capital and officer changes). Paid APIs (PredictLeads, TheirStack, Crustdata) only fill the gaps the free layer left (paid:"gap"), or always/never. → signals table, idempotent.';

export const Input = z.object({
  domain: z.string().min(1),
  company: z.string().optional().describe('name used to match news; read from the store or the site when absent'),
  country: z.string().optional().describe('ISO-2; US enables SEC Form D, FR enables BODACC'),
  siren: z.string().optional().describe('FR company id for BODACC; read from the store when the company came from the registry'),
  job_days: z.number().int().min(1).max(180).default(90),
  news_days: z.number().int().min(7).max(730).default(180),
  paid: z.enum(['gap', 'always', 'never']).default('gap'),
});
export type Input = z.infer<typeof Input>;
export interface Output { domain: string; signals: Signal[]; inserted: number; sources: Record<string, string>; covered: { funding: boolean; jobs: boolean; leadership: boolean; headcount: boolean } }

const key = (domain: string, type: string, source: string, ref: string) => sha256(`${domain}|${type}|${source}|${ref}`).slice(0, 32);
const day = (d: unknown) => (typeof d === 'string' && d.length >= 10 ? (d.length === 10 ? `${d}T00:00:00Z` : d) : undefined);

export async function pullSignals(raw: Input, ctx: PlayCtx): Promise<Output> {
  const input = Input.parse(raw);
  const domain = apexDomain(input.domain) ?? input.domain;
  const known = (await ctx.store.listCompanies([domain]))[0];
  const signals: Signal[] = [];
  const sources: Record<string, string> = {};
  const status = (id: string, rc: { status: string } | null) => { sources[id] = rc ? rc.status : 'skipped'; };

  // ---- free layer -------------------------------------------------------------------------
  const site = await readSite(ctx, domain, ['careers'], 1);
  sources.site = site.home ? 'hit' : 'miss';
  const name = input.company ?? known?.name ?? (site.home?.title ?? '').split(/[|\-–—:·]/)[0].trim() ?? domain.split('.')[0];
  const { ats, jobs } = await atsJobs(ctx, site.ats);
  sources.ats = ats ? (jobs.length ? 'hit' : 'miss') : 'no_board';
  const recent = jobs.filter((j) => !j.posted_at || Date.now() - Date.parse(j.posted_at) <= input.job_days * 86400000);
  if (ats) signals.push(...jobSignals(domain, ats, recent));

  if (name) {
    const news = await companyNews(ctx, name, input.news_days, { paidFallback: input.paid !== 'never' });
    sources.news = news.length ? 'hit' : 'miss';
    signals.push(...newsSignals(domain, news));
  }

  const country = (input.country ?? known?.country ?? '').toUpperCase();
  if (name && (!country || country === 'US' || country === 'USA' || country === 'UNITED STATES')) {
    const rc = await callLeg(ctx, 'sec_form_d', 'publicweb', 'form_d_search', { company: name });
    status('sec_form_d', rc);
    for (const f of ((rc?.output as any)?.filings ?? []) as any[]) {
      if (!f.names?.some((n: string) => n.toLowerCase().includes(name.toLowerCase()))) continue;
      signals.push({ dedupeKey: key(domain, 'funding_round', 'sec_form_d', `${f.cik}|${f.filed_at}`), domain, type: 'funding_round', source: 'sec_form_d', observedAt: day(f.filed_at), value: { title: `Form D filed by ${f.names[0]}`, url: f.url, note: 'US private offering; amount in the filing' } });
    }
  }
  const siren = input.siren ?? ((known?.raw as any)?.registry_fr?.siren as string | undefined);
  if (siren) {
    const rc = await callLeg(ctx, 'bodacc', 'registry_fr', 'bodacc_events', { siren });
    status('bodacc', rc);
    for (const e of ((rc?.output as any)?.events ?? []) as any[]) {
      const text = `${e.family ?? ''} ${e.detail ?? ''}`;
      const type = /capital/i.test(text) ? 'funding_round' : /dirigeant|g[ée]rant|pr[ée]sident|directeur g[ée]n[ée]ral|administrat/i.test(text) ? 'leadership_change' : /cr[ée]ation|[ée]tablissement/i.test(text) ? 'expansion' : null;
      if (!type) continue;
      signals.push({ dedupeKey: key(domain, type, 'bodacc', `${e.published_at}|${e.url ?? e.detail}`), domain, type, source: 'bodacc', observedAt: day(e.published_at), value: { title: e.detail || e.family, url: e.url, note: type === 'funding_round' ? 'capital change (BODACC), check the direction' : undefined } });
    }
  }

  const covered = () => ({
    funding: signals.some((s) => s.type === 'funding_round'),
    jobs: signals.some((s) => s.type === 'job_opening'),
    leadership: signals.some((s) => s.type === 'leadership_change'),
    headcount: signals.some((s) => s.type === 'headcount_growth'),
  });

  // ---- paid layer: only what the free layer did not cover ----------------------------------
  const want = (k: keyof Output['covered']) => input.paid === 'always' || (input.paid === 'gap' && !covered()[k]);
  const paid = async (id: string, provider: string, tool: string, inp: Record<string, unknown>, map: (o: any) => Signal[]) => {
    if (!canRun(ctx, provider, id)) { sources[id] = 'skipped'; return; }
    const rc = await callLeg(ctx, id, provider, tool, inp);
    status(id, rc);
    if (rc?.status !== 'hit') return;
    const found = map(rc.output);
    rc.meta.accepted = found.length;
    signals.push(...found);
  };
  if (want('funding')) await paid('predictleads_funding', 'predictleads', 'financing_events', { domain }, (o) => ((o?.events ?? []) as any[]).map((e) => ({
    dedupeKey: key(domain, 'funding_round', 'predictleads', `${e.date}|${e.financing_type}|${e.amount}`), domain, type: 'funding_round', source: 'predictleads',
    value: { amount_usd: e.amount, currency: e.currency, round: e.financing_type, url: e.url ?? e.article_url }, observedAt: day(e.date),
  })));
  else sources.predictleads_funding = 'covered_free';
  if (want('jobs')) {
    await paid('predictleads_jobs', 'predictleads', 'job_openings', { domain }, (o) => ((o?.jobs ?? []) as any[]).map((j) => ({
      dedupeKey: key(domain, 'job_opening', 'predictleads', j.url ?? `${j.title}|${j.first_seen_at}`), domain, type: 'job_opening', source: 'predictleads',
      value: { title: j.title, url: j.url, categories: j.categories }, observedAt: day(j.first_seen_at),
    })));
    if (want('jobs')) await paid('theirstack_jobs', 'theirstack', 'job_search', { company_domain_or: [domain], posted_at_max_age_days: input.job_days, limit: 25, page: 0, include_total_results: true }, (o) => ((o?.jobs ?? o?.results ?? []) as any[]).map((j) => ({
      dedupeKey: key(domain, 'job_opening', 'theirstack', j.url ?? `${j.job_title}|${j.date_posted}`), domain, type: 'job_opening', source: 'theirstack',
      value: { title: j.job_title, url: j.url, location: j.location }, observedAt: day(j.date_posted),
    })));
  } else { sources.predictleads_jobs = 'covered_free'; sources.theirstack_jobs = 'covered_free'; }
  // Headcount growth has no free source: it runs whenever paid is allowed.
  if (input.paid !== 'never') await paid('crustdata_headcount', 'crustdata', 'company_enrich', { domain }, (o) => {
    const pct = o?.headcount_growth_6m_pct ?? o?.headcount?.linkedin_headcount_total_growth_percent?.six_months ?? o?.headcount?.linkedin_headcount_total_growth_percent;
    const month = new Date().toISOString().slice(0, 7);
    return typeof pct === 'number' ? [{ dedupeKey: key(domain, 'headcount_growth', 'crustdata', month), domain, type: 'headcount_growth', source: 'crustdata', value: { pct, headcount: o?.headcount?.linkedin_headcount ?? o?.headcount }, observedAt: `${month}-01T00:00:00Z` }] : [];
  });

  const inserted = await ctx.store.upsertSignals(signals);
  return { domain, signals, inserted, sources, covered: covered() };
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  run: (input, ctx) => pullSignals(input, ctx),
});

export const batch = definePlay<BatchInput, BatchOutput>({
  name: `${NAME}:batch`, description: `${DESCRIPTION} (batch over a domain column; optional company, country, siren columns)`, kind: 'batch', input: BatchInput,
  async run(input, ctx) {
    const { datasetId, rows } = await ctx
      .dataset(input.rows, { slug: input.slug, rowKey: (r) => `co:${apexDomain(r.domain) ?? r.domain}` })
      .withColumn('signals', async (row: RowState) => (row.input.domain ? (await pullSignals({ domain: row.input.domain, company: row.input.company || undefined, country: row.input.country || undefined, siren: row.input.siren || undefined, job_days: 90, news_days: 180, paid: (row.input.paid as Input['paid']) || 'gap' }, ctx)) : { status: 'skipped', missReason: 'missing_domain' }), { concurrency: 2 })
      .run();
    return { rows, field: 'signals', legIds: [], datasetId };
  },
});
