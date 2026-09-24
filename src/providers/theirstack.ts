import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';

const BASE = 'https://api.theirstack.com/v1';
const PRICE = {
  company_search: { basis: 'per_result', credits: 1, note: 'billed per company returned; limit:1 for sizing bills one. costOverride = results × 1' },
  job_search: { basis: 'per_result', credits: 0.5, note: 'billed per job returned; costOverride = results × 0.5' },
} as const;

function headers() {
  return { 'content-type': 'application/json', authorization: `Bearer ${env('THEIRSTACK_API_KEY') ?? ''}` };
}

const sortedArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.length ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].sort() : undefined;
const arrs = (i: Record<string, unknown>, keys: string[]) => {
  const out: Record<string, string[]> = {};
  for (const k of keys) { const a = sortedArr(i[k]); if (a) out[k] = a; }
  return out;
};

/**
 * TheirStack: companies (tech stack, headcount) and job postings. Every returned row is billed, so `limit` is the budget.
 * `metadata.total_results` is preserved as `total` so a sizing call (limit:1) tells you the pool for the price of one row.
 */
export const theirstack = defineAdapter({
  name: 'theirstack',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['THEIRSTACK_API_KEY'],
  tools: {
    company_search: {
      description: 'Search companies by country, headcount, industry, technology; returns domains and total pool size.',
      normalize: (i) => ({
        limit: Number(i.limit ?? 25), page: Number(i.page ?? 0),
        ...arrs(i, ['company_country_code_or', 'industry_id_or', 'technology_slug_or', 'company_name_partial_match_or', 'company_domain_or']),
        ...(i.employee_count_min != null ? { employee_count_min: Number(i.employee_count_min) } : {}),
        ...(i.employee_count_max != null ? { employee_count_max: Number(i.employee_count_max) } : {}),
      }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/companies/search`, { // verify against docs
          method: 'POST', headers: headers(), body: JSON.stringify({ ...i, include_total_results: true }),
        });
        if (status !== 200) return errorResult(status, body, body?.detail ?? body?.message);
        const rows: any[] = body?.data ?? [];
        const results = rows.map((c) => ({
          ...pick(c, ['name', 'domain', 'employee_count', 'country_code', 'industry', 'technology_slugs', 'linkedin_url', 'founded_year', 'city', 'num_jobs']),
          technology_slugs: c.technology_slugs ?? (c.technologies_found ?? []).map((t: any) => t.technology?.slug ?? t.slug).filter(Boolean),
        }));
        const out = { results, total: Number(body?.metadata?.total_results ?? results.length), page: i.page, limit: i.limit };
        const costOverride = results.length * PRICE.company_search.credits;
        return results.length ? { status: 'hit', output: out, costOverride } : { status: 'miss', missReason: 'no_results', output: out, costOverride };
      },
      cost: costFromTable(PRICE.company_search),
    },
    job_search: {
      description: 'Search job postings by company domain, recency (≤180 days) and title pattern; returns total pool size.',
      normalize: (i) => ({
        limit: Number(i.limit ?? 25), page: Number(i.page ?? 0),
        posted_at_max_age_days: Math.min(Math.max(Number(i.posted_at_max_age_days ?? 90), 1), 180),
        ...arrs(i, ['company_domain_or', 'job_title_pattern_or', 'job_country_code_or', 'company_country_code_or']),
      }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/jobs/search`, { // verify against docs
          method: 'POST', headers: headers(), body: JSON.stringify({ ...i, include_total_results: true }),
        });
        if (status !== 200) return errorResult(status, body, body?.detail ?? body?.message);
        const rows: any[] = body?.data ?? [];
        const results = rows.map((j) => ({
          ...pick(j, ['job_title', 'date_posted', 'url', 'location', 'seniority', 'remote']),
          company_domain: j.company?.domain ?? j.company_domain ?? null,
          company_name: j.company?.name ?? j.company_name ?? null,
        }));
        const out = { results, total: Number(body?.metadata?.total_results ?? results.length), page: i.page, limit: i.limit };
        const costOverride = results.length * PRICE.job_search.credits;
        return results.length ? { status: 'hit', output: out, costOverride } : { status: 'miss', missReason: 'no_results', output: out, costOverride };
      },
      cost: costFromTable(PRICE.job_search),
    },
  },
});
