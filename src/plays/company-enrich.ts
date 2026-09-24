import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { apexDomain } from '../core/normalize.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { GoldenCompany } from '../store/store.ts';
import type { LegMeta } from '../core/types.ts';
import { BatchInput, type BatchOutput } from '../core/row-play.ts';
import type { RowState } from '../core/types.ts';

export const NAME = 'company-enrich';
export const DESCRIPTION = 'Company profile from domain: apollo → pdl → crustdata, merged field by field by precedence (not a waterfall).';

export const Input = z.object({ domain: z.string().min(1) });
export type Input = z.infer<typeof Input>;

const FIELDS = ['name', 'linkedin_url', 'country', 'city', 'industry', 'headcount', 'employees_range', 'founded_year', 'funding_total_usd', 'funding_last_round', 'funding_last_date', 'tech'] as const;
type Field = (typeof FIELDS)[number];
const SOURCES: Array<[string, string, string]> = [['apollo', 'apollo', 'organizations_enrich'], ['pdl', 'peopledatalabs', 'company_enrich'], ['crustdata', 'crustdata', 'company_enrich']];

export interface CompanyProfile extends GoldenCompany {
  sources: Record<string, 'hit' | 'miss' | 'error' | 'skipped'>;
}

/** Precedence merge: first source (in order) that has a value wins; every field names its source. */
export async function enrichOne(domainRaw: string, ctx: PlayCtx): Promise<CompanyProfile> {
  const domain = apexDomain(domainRaw) ?? domainRaw;
  const profile: CompanyProfile = { domain, fieldSources: {}, raw: { enriched_at: new Date().toISOString() }, sources: {} };
  for (const [id, provider, tool] of SOURCES) {
    const meta: LegMeta = { leg: id, provider, tool, rowsReached: 0, accepted: 0, receiptIds: [] };
    ctx.metas.push(meta);
    if (!legEnabled(ctx, provider, id)) { profile.sources[id] = 'skipped'; continue; }
    meta.rowsReached = 1;
    const rc = await ctx.runner.execute({ provider, tool, input: { domain }, runId: ctx.runId });
    meta.receiptIds!.push(rc.id);
    if (!rc.cached) ctx.spent.credits += rc.costCredits;
    profile.sources[id] = rc.status;
    if (rc.status !== 'hit') continue;
    meta.accepted = 1;
    const o = rc.output as Record<string, unknown>;
    profile.raw[id] = o;
    for (const f of FIELDS) {
      const v = pickField(o, f);
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      const key = camel(f) as keyof GoldenCompany;
      if ((profile as any)[key] === undefined) { (profile as any)[key] = v; profile.fieldSources[key] = id; }
    }
  }
  return profile;
}

const ALIASES: Record<Field, string[]> = {
  name: ['name', 'company_name'], linkedin_url: ['linkedin_url', 'linkedin_profile_url'], country: ['country', 'hq_country', 'country_code'], city: ['city', 'hq_city'],
  industry: ['industry'], headcount: ['headcount', 'estimated_num_employees', 'employee_count', 'linkedin_headcount'], employees_range: ['employees_range', 'employee_range', 'size'],
  founded_year: ['founded_year', 'year_founded', 'founded'], funding_total_usd: ['funding_total_usd', 'total_funding', 'total_funding_raised'],
  funding_last_round: ['funding_last_round', 'latest_funding_stage', 'last_funding_round'], funding_last_date: ['funding_last_date', 'latest_funding_round_date', 'last_funding_date'],
  tech: ['tech', 'technology_names', 'technologies', 'tags'],
};
function pickField(o: Record<string, unknown>, f: Field): unknown {
  for (const k of ALIASES[f]) if (o[k] !== undefined) return f === 'headcount' || f === 'founded_year' || f === 'funding_total_usd' ? toNum(o[k]) : o[k];
  return undefined;
}
const toNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

export const scalar = definePlay<Input, CompanyProfile>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const profile = await enrichOne(input.domain, ctx);
    await ctx.store.upsertCompany(profile);
    return profile;
  },
});

export const batch = definePlay<BatchInput, BatchOutput>({
  name: `${NAME}:batch`, description: `${DESCRIPTION} (batch over a domain column)`, kind: 'batch', input: BatchInput,
  async run(input, ctx) {
    const { datasetId, rows } = await ctx
      .dataset(input.rows, { slug: input.slug, rowKey: (r) => `co:${apexDomain(r.domain) ?? r.domain}` })
      .withColumn('company_profile', async (row: RowState) => {
        if (!row.input.domain) return { status: 'skipped', missReason: 'missing_domain' };
        const p = await enrichOne(row.input.domain, ctx);
        await ctx.store.upsertCompany(p);
        return p;
      }, { concurrency: 2 })
      .run();
    return { rows, field: 'company_profile', legIds: [], datasetId };
  },
});
