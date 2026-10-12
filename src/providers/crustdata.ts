import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';

const PRICE = {
  person_enrich: { basis: 'per_result', credits: 1, note: 'billed per returned result; empty results free' },
  company_enrich: { basis: 'per_result', credits: 1, note: 'billed per returned company (estimate)' },
  company_search: { basis: 'per_result', credits: 0.1, note: 'billed per returned company (estimate)' },
} as const;

const auth = () => ({ authorization: `Token ${env('CRUSTDATA_API_KEY') ?? ''}`, accept: 'application/json' });
const BANDS: Array<[string, number, number]> = [['1-10', 1, 10], ['11-50', 11, 50], ['51-200', 51, 200], ['201-500', 201, 500], ['501-1,000', 501, 1000], ['1,001-5,000', 1001, 5000], ['5,001-10,000', 5001, 10000], ['10,001+', 10001, 1e9]];
const countryName = (c: string) => { try { return c.length === 2 ? new Intl.DisplayNames(['en'], { type: 'region' }).of(c.toUpperCase()) ?? c : c; } catch { return c; } };

/** Crustdata person enrichment by LinkedIn URL (business_email). Optional leg; needs linkedin_url. */
export const crustdata = defineAdapter({
  name: 'crustdata',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-23 (estimate)', table: PRICE },
  requiredEnv: ['CRUSTDATA_API_KEY'],
  tools: {
    person_enrich: {
      description: 'Enrich a person by LinkedIn profile URL, including business email when available.',
      normalize: (i) => pick(i, ['linkedin_url']),
      async execute(i, ctx) {
        const params = new URLSearchParams({ linkedin_profile_url: String(i.linkedin_url), fields: 'business_email,current_employers,name' });
        const { status, body } = await httpJson(ctx, `https://api.crustdata.com/screener/person/enrich?${params}`, {
          headers: { authorization: `Token ${env('CRUSTDATA_API_KEY') ?? ''}`, accept: 'application/json' },
        });
        if (status !== 200) return errorResult(status, body, body?.error ?? body?.detail);
        const p = Array.isArray(body) ? body[0] : body;
        if (!p) return { status: 'miss', missReason: 'no_match', output: {} };
        const email = p.business_email ?? p.business_emails?.[0];
        const out = { ...pick(p, ['name', 'linkedin_profile_url', 'business_email']), email, email_status: email ? 'valid' : undefined };
        return email ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_business_email', output: out };
      },
      cost: costFromTable(PRICE.person_enrich),
    },
    company_enrich: {
      description: 'Company by domain: LinkedIn headcount and its 6-month growth, funding, location, industry.',
      normalize: (i) => ({ domain: String(i.domain ?? '').trim().toLowerCase() }),
      async execute(i, ctx) { // verify against docs
        const { status, body } = await httpJson(ctx, `https://api.crustdata.com/screener/company?company_domain=${encodeURIComponent(String(i.domain))}`, { headers: auth() });
        if (status === 404) return { status: 'miss', missReason: 'no_match', output: {} };
        if (status !== 200) return errorResult(status, body, body?.error ?? body?.detail);
        const c = Array.isArray(body) ? body[0] : body;
        if (!c) return { status: 'miss', missReason: 'no_match', output: {} };
        const hc = c.headcount ?? {};
        return { status: 'hit', output: { name: c.company_name ?? c.name, linkedin_url: c.linkedin_profile_url, country: c.hq_country, industry: c.linkedin_industries?.[0] ?? c.industry, headcount: hc.linkedin_headcount ?? c.employee_count_range, headcount_growth_6m_pct: hc.linkedin_headcount_total_growth_percent?.six_months ?? null, funding_total_usd: c.funding_and_investment?.crunchbase_total_investment_usd ?? null } };
      },
      cost: costFromTable(PRICE.company_enrich),
    },
    company_search: {
      description: 'Company search with filters (country, headcount, industry, keywords); total_display_count sizes the pool.',
      normalize: (i) => ({ filters: i.filters ?? {}, limit: Number(i.limit ?? 25), page: Number(i.page ?? 1) }),
      async execute(i, ctx) { // verify against docs
        const f = (i.filters ?? {}) as Record<string, any>;
        const filters: Array<Record<string, unknown>> = [];
        if (f.country?.length) filters.push({ filter_type: 'REGION', type: 'in', value: (f.country as string[]).map(countryName) });
        if (f.headcount_min !== undefined || f.headcount_max !== undefined) filters.push({ filter_type: 'COMPANY_HEADCOUNT', type: 'in', value: BANDS.filter(([, lo, hi]) => hi >= (f.headcount_min ?? 0) && lo <= (f.headcount_max ?? 1e9)).map(([b]) => b) });
        if (f.industry?.length) filters.push({ filter_type: 'INDUSTRY', type: 'in', value: f.industry });
        if (f.keywords?.length) filters.push({ filter_type: 'KEYWORD', type: 'in', value: f.keywords });
        const { status, body } = await httpJson(ctx, 'https://api.crustdata.com/screener/company/search', { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ filters, page: i.page }) });
        if (status !== 200) return errorResult(status, body, body?.error ?? body?.detail);
        const companies = (body?.companies ?? []).slice(0, Number(i.limit)).map((c: any) => ({ name: c.name ?? c.company_name, domain: c.company_website_domain ?? c.website, linkedin_url: c.linkedin_profile_url, employee_count: c.employee_count_range, country: c.location }));
        const out = { companies, total: body?.total_display_count ?? null };
        return companies.length ? { status: 'hit', output: out, costOverride: companies.length * PRICE.company_search.credits } : { status: 'miss', missReason: 'no_results', output: out, costOverride: 0 };
      },
      cost: costFromTable(PRICE.company_search),
    },
  },
});
