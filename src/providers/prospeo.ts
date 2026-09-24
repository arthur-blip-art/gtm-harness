import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import { nameToken, normalizeLinkedin } from '../core/normalize.ts';
import type { ToolInput } from '../core/types.ts';

const BASE = 'https://api.prospeo.io';
const PRICE = {
  enrich_person: { basis: 'per_hit', credits: 1, note: '1 credit when an email is returned; no charge on miss' },
  search_person: { basis: 'per_call', credits: 1, note: 'billed per page of 25 results, not per result; counted as 1 credit per call' },
  search_company: { basis: 'per_call', credits: 1, note: 'billed per page of 25 results; counted as 1 credit per call' },
} as const;

function headers() {
  return { 'content-type': 'application/json', 'X-KEY': env('PROSPEO_API_KEY') ?? '' };
}

const sortedArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.length ? [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter(Boolean))].sort() : undefined;

function searchFilters(i: ToolInput, keys: string[]): Record<string, string[]> {
  const src = (i.filters && typeof i.filters === 'object' ? i.filters : i) as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const k of keys) { const a = sortedArr(src[k]); if (a) out[k] = a; }
  return out;
}

const PERSON_FILTERS = ['company_website_or', 'job_title_or', 'seniority_or', 'company_industry_or', 'person_location_or'];
const COMPANY_FILTERS = ['company_website_or', 'company_name_or', 'company_industry_or', 'company_size_or', 'company_location_or', 'company_keyword_or'];

/**
 * Prospeo. enrich-person takes a LinkedIn URL or name + company website and returns one email with a status.
 * Search endpoints are billed per page (25) regardless of how many results are used: size `limit` to what you will consume.
 */
export const prospeo = defineAdapter({
  name: 'prospeo',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['PROSPEO_API_KEY'],
  tools: {
    enrich_person: {
      description: 'Enrich a person (email) from a LinkedIn URL, or from first name + last name + company website.',
      normalize: (i) => {
        const linkedin_url = normalizeLinkedin(i.linkedin_url);
        return linkedin_url
          ? { linkedin_url }
          : { first_name: nameToken(i.first_name), last_name: nameToken(i.last_name), company_website: String(i.company_website ?? i.domain ?? '') };
      },
      async execute(i, ctx) {
        const data = i.linkedin_url
          ? { linkedin_url: i.linkedin_url }
          : { first_name: i.first_name, last_name: i.last_name, company_website: i.company_website };
        const { status, body } = await httpJson(ctx, `${BASE}/enrich-person`, { // verify against docs
          method: 'POST', headers: headers(), body: JSON.stringify({ data, enrich_email: true }),
        });
        if (status === 404 || (status === 400 && /NO_RESULT|NOT_FOUND/i.test(String(body?.message ?? body?.error_code ?? '')))) {
          return { status: 'miss', missReason: 'no_match', output: pick(body ?? {}, ['message', 'error_code']) };
        }
        if (status !== 200 || body?.error === true) return errorResult(status, body, body?.message ?? body?.error_code);
        const p = body?.person ?? body?.response ?? {};
        const email = p.email?.email ?? (typeof p.email === 'string' ? p.email : null);
        const out = {
          email: email ?? null,
          email_status: p.email?.status ?? null, // VALID|CATCH_ALL|... (raw provider casing)
          ...pick(p, ['first_name', 'last_name', 'full_name', 'job_title', 'linkedin_url', 'location']),
          company_website: p.company?.website ?? p.company_website ?? null,
          company_name: p.company?.name ?? null,
        };
        if (!email) return { status: 'miss', missReason: 'person_found_no_email', output: out };
        return { status: 'hit', output: out };
      },
      cost: costFromTable(PRICE.enrich_person),
    },
    search_person: {
      description: 'Search people by company website, job title and seniority filters (paged, 25 per page).',
      normalize: (i) => ({ filters: searchFilters(i, PERSON_FILTERS), page: Number(i.page ?? 1), limit: Math.min(Number(i.limit ?? 25), 25) }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/search-person`, { // verify against docs
          method: 'POST', headers: headers(), body: JSON.stringify({ filters: i.filters, page: i.page, limit: i.limit }),
        });
        if (status !== 200 || body?.error === true) return errorResult(status, body, body?.message ?? body?.error_code);
        const rows: any[] = body?.results ?? body?.response?.results ?? [];
        const results = rows.map((r) => ({
          ...pick(r, ['first_name', 'last_name', 'full_name', 'job_title', 'linkedin_url', 'location', 'seniority']),
          company_website: r.company?.website ?? r.company_website ?? null,
          company_name: r.company?.name ?? r.company_name ?? null,
        }));
        const out = { results, total: Number(body?.total ?? body?.response?.total ?? results.length), page: i.page, limit: i.limit };
        return results.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_results', output: out };
      },
      cost: costFromTable(PRICE.search_person),
    },
    search_company: {
      description: 'Search companies by website/name/industry/size filters (paged, 25 per page).',
      normalize: (i) => ({ filters: searchFilters(i, COMPANY_FILTERS), page: Number(i.page ?? 1), limit: Math.min(Number(i.limit ?? 25), 25) }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/search-company`, { // verify against docs
          method: 'POST', headers: headers(), body: JSON.stringify({ filters: i.filters, page: i.page, limit: i.limit }),
        });
        if (status !== 200 || body?.error === true) return errorResult(status, body, body?.message ?? body?.error_code);
        const rows: any[] = body?.results ?? body?.response?.results ?? [];
        const results = rows.map((r) => pick(r, ['name', 'website', 'domain', 'industry', 'size', 'employee_count', 'location', 'linkedin_url', 'description']));
        const out = { results, total: Number(body?.total ?? body?.response?.total ?? results.length), page: i.page, limit: i.limit };
        return results.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_results', output: out };
      },
      cost: costFromTable(PRICE.search_company),
    },
  },
});
