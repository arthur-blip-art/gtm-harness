import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { apexDomain } from '../core/normalize.ts';
import { legEnabled } from './name-domain-to-email.ts';
import { callLeg } from '../core/leg.ts';
import { NOT_A_COMPANY, resolveDomain } from '../core/resolve-domain.ts';
import { headcountBands, SAAS_NAF } from '../providers/registry-fr.ts';
import type { LegMeta } from '../core/types.ts';

export const NAME = 'icp-to-companies';
export const DESCRIPTION = 'ICP filters → company list, cheapest sources first. Free: lookalikes of seed customers (Exa find_similar, ~$0.005) and, for France, the public registry by NAF code and headcount band (officers included, domain resolved by one Serper query). Paid databases (Apollo, TheirStack, Crustdata) are sized with limit:1, then bought only for the rows still missing. Dedupes by apex domain.';

export const Input = z.object({
  industries: z.array(z.string()).optional(),
  countries: z.array(z.string()).optional().describe('ISO-2 codes'),
  headcount_min: z.number().int().optional(),
  headcount_max: z.number().int().optional(),
  keywords: z.array(z.string()).optional(),
  tech: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(5000).default(50),
  sources: z.array(z.enum(['apollo', 'theirstack', 'crustdata'])).optional().describe('paid sources, in order'),
  size_only: z.boolean().default(false),
  seed_domains: z.array(z.string()).optional().describe('best customers or look-alike targets: Exa find_similar on each homepage'),
  naf: z.array(z.string()).optional().describe('FR registry NAF codes; default for FR: software publishing and IT services (58.29*, 62.01Z, 63.11Z, 62.02A)'),
  departements: z.array(z.string()).optional().describe('FR departments, e.g. ["75","92","69"]'),
  public_first: z.boolean().default(true).describe('run the free sources before any paid database'),
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

    // 0. free and near-free sources first
    if (input.public_first) {
      for (const seed of input.seed_domains ?? []) {
        if (byDomain.size >= input.limit) break;
        const d0 = apexDomain(seed);
        if (!d0) continue;
        const rc = await callLeg(ctx, 'exa_similar', 'exa', 'find_similar', { url: `https://${d0}/`, numResults: 25 });
        const rows = ((rc?.output as any)?.results ?? []) as Array<{ url: string; title?: string }>;
        counts.exa_similar = (counts.exa_similar ?? 0) + rows.length;
        for (const r of rows) {
          const domain = apexDomain(r.url);
          if (!domain || NOT_A_COMPANY.test(domain) || byDomain.has(domain) || domain === d0 || byDomain.size >= input.limit) continue;
          byDomain.set(domain, { domain, name: (r.title ?? '').split(/[|\-–—:·]/)[0].trim() || undefined, source: 'exa_similar', raw: { seed: d0, url: r.url, title: r.title } });
          if (rc) rc.meta.accepted++;
        }
      }
      const fr = (input.countries ?? []).some((c) => /^fr(ance)?$/i.test(c));
      if (fr || input.naf?.length) {
        const naf = input.naf ?? SAAS_NAF;
        const bands = headcountBands(input.headcount_min, input.headcount_max);
        for (let page = 1; byDomain.size < input.limit && page <= 20; page++) {
          const rc = await callLeg(ctx, `registry_fr:p${page}`, 'registry_fr', 'search_companies', { naf, departements: input.departements ?? [], bands, page, per_page: 25 });
          if (page === 1) counts.registry_fr = (rc?.output as any)?.total ?? null;
          const rows = ((rc?.output as any)?.companies ?? []) as any[];
          if (!rows.length || input.size_only) break;
          for (const r of rows) {
            if (byDomain.size >= input.limit) break;
            const resolved = await resolveDomain(ctx, r.name, r.city ?? '');
            if (!resolved || byDomain.has(resolved.domain)) continue;
            byDomain.set(resolved.domain, { domain: resolved.domain, name: r.name, source: 'registry_fr', raw: { ...r, domain_via: resolved.via } });
            if (rc) rc.meta.accepted++;
          }
          if (rows.length < 25) break;
        }
      }
      if (byDomain.size) ctx.log(`free sources: ${byDomain.size} companies (${Object.entries(counts).map(([k, v]) => `${k}=${v ?? '?'}`).join(' ')})`);
    }
    if (byDomain.size >= input.limit && !input.size_only) return finish(ctx, byDomain, counts, bought);

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
    if (byDomain.size >= input.limit) return finish(ctx, byDomain, counts, bought);

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
    return finish(ctx, byDomain, counts, bought);
  },
});

async function finish(ctx: PlayCtx, byDomain: Map<string, CompanyHit>, counts: Output['counts'], bought: Output['bought']): Promise<Output> {
  const companies = [...byDomain.values()];
  for (const c of companies) {
    const r = c.raw as any;
    await ctx.store.upsertCompany({
      domain: c.domain, name: c.name || undefined, fieldSources: { name: c.source, ...(c.source === 'registry_fr' ? { country: 'registry_fr', employeesRange: 'registry_fr' } : {}) },
      ...(c.source === 'registry_fr' ? { country: 'FR', city: r.city ?? undefined, employeesRange: r.headcount_band ?? undefined, industry: 'software' } : {}),
      raw: { [c.source]: c.raw },
    });
  }
  return { counts, companies, bought };
}
