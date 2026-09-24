import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { apexDomain } from '../core/normalize.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta } from '../core/types.ts';

export const NAME = 'icp-to-companies';
export const DESCRIPTION = 'ICP filters → company list. Sizes each source with limit:1 first, then buys up to `limit` and dedupes by apex domain.';

export const Input = z.object({
  industries: z.array(z.string()).optional(),
  countries: z.array(z.string()).optional().describe('ISO-2 codes'),
  headcount_min: z.number().int().optional(),
  headcount_max: z.number().int().optional(),
  keywords: z.array(z.string()).optional(),
  tech: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(5000).default(50),
  sources: z.array(z.enum(['apollo', 'theirstack', 'crustdata'])).optional(),
  size_only: z.boolean().default(false),
});
export type Input = z.infer<typeof Input>;

export interface CompanyHit { domain: string; name?: string; source: string; raw: Record<string, unknown> }
export interface Output { counts: Record<string, number | null>; companies: CompanyHit[]; bought: Record<string, number> }

const PAGE = 25;

function buildQuery(source: string, i: Input, limit: number, page: number): Record<string, unknown> {
  if (source === 'apollo') return { organization_locations: i.countries, organization_num_employees_ranges: i.headcount_min || i.headcount_max ? [`${i.headcount_min ?? 1},${i.headcount_max ?? 100000}`] : undefined, q_organization_keyword_tags: [...(i.industries ?? []), ...(i.keywords ?? [])], currently_using_any_of_technology_uids: i.tech, per_page: limit, page: page + 1 };
  if (source === 'theirstack') return { company_country_code_or: i.countries, employee_count_min: i.headcount_min, employee_count_max: i.headcount_max, industry_id_or: i.industries, technology_slug_or: i.tech, company_name_partial_match_or: i.keywords, limit, page };
  return { filters: { country: i.countries, headcount_min: i.headcount_min, headcount_max: i.headcount_max, industry: i.industries, keywords: i.keywords, tech: i.tech }, limit, page: page + 1 };
}
const TOOL: Record<string, [string, string]> = { apollo: ['apollo', 'mixed_companies_search'], theirstack: ['theirstack', 'company_search'], crustdata: ['crustdata', 'company_search'] };

function rowsOf(output: any): Array<Record<string, unknown>> {
  return output?.companies ?? output?.results ?? output?.organizations ?? output?.data ?? [];
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const sources = (input.sources ?? ['apollo', 'theirstack', 'crustdata']).filter((s) => legEnabled(ctx, TOOL[s][0], s));
    const counts: Record<string, number | null> = {};
    const bought: Record<string, number> = {};
    const byDomain = new Map<string, CompanyHit>();

    // 1. size with limit:1 — most providers return the total for the price of one row
    for (const s of sources) {
      const [provider, tool] = TOOL[s];
      const meta: LegMeta = { leg: `${s}_size`, provider, tool, rowsReached: 1, accepted: 0, receiptIds: [] };
      ctx.metas.push(meta);
      const rc = await ctx.runner.execute({ provider, tool, input: buildQuery(s, input, 1, 0), runId: ctx.runId });
      meta.receiptIds!.push(rc.id);
      if (!rc.cached) ctx.spent.credits += rc.costCredits;
      const total = (rc.output as any)?.total ?? (rc.output as any)?.pagination?.total_entries ?? (rc.output as any)?.metadata?.total_results ?? null;
      counts[s] = total === null ? null : Number(total);
      if (rc.status === 'hit') meta.accepted = 1;
    }
    ctx.log(`sizing: ${Object.entries(counts).map(([k, v]) => `${k}=${v ?? '?'}`).join(' ')}`);
    if (input.size_only) return { counts, companies: [], bought };

    // 2. buy, source by source, until `limit` distinct apex domains
    for (const s of sources) {
      const [provider, tool] = TOOL[s];
      const meta: LegMeta = { leg: s, provider, tool, rowsReached: 0, accepted: 0, receiptIds: [] };
      ctx.metas.push(meta);
      bought[s] = 0;
      for (let page = 0; byDomain.size < input.limit && page < 200; page++) {
        const want = Math.min(PAGE, input.limit - byDomain.size);
        const rc = await ctx.runner.execute({ provider, tool, input: buildQuery(s, input, want, page), runId: ctx.runId });
        meta.receiptIds!.push(rc.id);
        meta.rowsReached++;
        if (!rc.cached) ctx.spent.credits += rc.costCredits;
        if (ctx.maxCredits !== undefined && ctx.spent.credits > ctx.maxCredits) throw new (await import('../core/waterfall.ts')).BudgetExceeded(ctx.spent.credits, ctx.maxCredits);
        const rows = rowsOf(rc.output);
        if (!rows.length) break;
        for (const r of rows) {
          const domain = apexDomain(r.domain ?? r.website ?? r.primary_domain ?? r.website_url);
          if (!domain || byDomain.has(domain)) continue;
          byDomain.set(domain, { domain, name: String(r.name ?? r.company_name ?? ''), source: s, raw: r });
          meta.accepted++;
          bought[s]++;
        }
        if (rows.length < want) break;
      }
    }
    const companies = [...byDomain.values()];
    for (const c of companies) await ctx.store.upsertCompany({ domain: c.domain, name: c.name || undefined, fieldSources: { name: c.source }, raw: { [c.source]: c.raw } });
    return { counts, companies, bought };
  },
});
