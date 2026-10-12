import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import { nameToken } from '../core/normalize.ts';

const PRICE = {
  people_match: { basis: 'per_hit', credits: 1, note: '1 export credit when a net-new email is revealed; no charge on miss' },
  mixed_people_search: { basis: 'per_call', credits: 0.1, note: '~$0.01 flat per page whatever the result count (GooseWorks/Orthogonal figures); no email revealed' },
  mixed_companies_search: { basis: 'per_call', credits: 0.1, note: '~$0.01 per page (estimate, plan dependent)' },
  organizations_enrich: { basis: 'per_call', credits: 0.1, note: '~$0.01 per call (Orthogonal figure)' },
} as const;

const API = 'https://api.apollo.io/api/v1';
const post = (path: string, body: Record<string, unknown>, ctx: Parameters<typeof httpJson>[0]) =>
  httpJson(ctx, `${API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-cache', 'x-api-key': env('APOLLO_API_KEY') ?? '' }, body: JSON.stringify(body) });
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));

/**
 * Apollo.io. API access needs a paid plan. people/match reveals one work email per call.
 * Rate limits are per minute/hour/day and plan dependent; the runner calls sequentially and backs off on 429.
 */
export const apollo = defineAdapter({
  name: 'apollo',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-23 (estimate, check your plan)', table: PRICE },
  requiredEnv: ['APOLLO_API_KEY'],
  tools: {
    people_match: {
      description: 'Find a person and reveal their work email from name + domain (or LinkedIn URL).',
      normalize: (i) => ({
        first_name: nameToken(i.first_name), last_name: nameToken(i.last_name),
        ...pick(i, ['domain', 'linkedin_url']),
      }),
      async execute(input, ctx) {
        const body: Record<string, unknown> = {
          ...input, reveal_personal_emails: false, reveal_phone_number: false,
        };
        const { status, body: res } = await httpJson(ctx, 'https://api.apollo.io/api/v1/people/match', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cache-control': 'no-cache', 'x-api-key': env('APOLLO_API_KEY') ?? '' },
          body: JSON.stringify(body),
        });
        if (status === 404 || (status === 200 && !res?.person)) return { status: 'miss', missReason: 'no_match', output: res };
        if (status !== 200) return errorResult(status, res, res?.error ?? res?.message);
        const p = res.person;
        const out = pick(p, ['id', 'first_name', 'last_name', 'email', 'email_status', 'linkedin_url', 'title', 'headline']);
        out.organization = pick(p.organization ?? {}, ['name', 'primary_domain', 'website_url', 'linkedin_url', 'estimated_num_employees', 'industry']);
        if (!p.email) return { status: 'miss', missReason: 'person_found_no_email', output: out };
        return { status: 'hit', output: out };
      },
      cost: costFromTable(PRICE.people_match),
    },
    mixed_people_search: {
      description: 'People at given domains by title / seniority (names, titles, LinkedIn URLs; no email). One page per call.',
      normalize: (i) => clean({ domains: ((i.domains as string[] | undefined) ?? []).map(String).sort(), titles: (i.titles as string[] | undefined) ?? [], seniorities: (i.seniorities as string[] | undefined) ?? [], per_page: Number(i.per_page ?? 10), page: Number(i.page ?? 1) }),
      async execute(i, ctx) { // verify against docs
        const { status, body } = await post('mixed_people/search', clean({ q_organization_domains_list: i.domains, person_titles: i.titles, person_seniorities: i.seniorities, per_page: i.per_page, page: i.page }), ctx);
        if (status !== 200) return errorResult(status, body, body?.error ?? body?.message);
        const people = (body?.people ?? body?.contacts ?? []).map((p: any) => ({ first_name: p.first_name, last_name: p.last_name, title: p.title, linkedin_url: p.linkedin_url, domain: p.organization?.primary_domain }));
        const out = { people, total: body?.pagination?.total_entries ?? null };
        return people.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_results', output: out };
      },
      cost: costFromTable(PRICE.mixed_people_search),
    },
    mixed_companies_search: {
      description: 'Companies by location, headcount range, keyword tags, technologies. One page per call; pagination.total_entries sizes the pool.',
      normalize: (i) => clean({ ...i }),
      async execute(i, ctx) { // verify against docs
        const { status, body } = await post('mixed_companies/search', clean({ ...i }), ctx);
        if (status !== 200) return errorResult(status, body, body?.error ?? body?.message);
        const companies = [...(body?.organizations ?? []), ...(body?.accounts ?? [])].map((o: any) => ({ name: o.name, domain: o.primary_domain ?? o.website_url, linkedin_url: o.linkedin_url, employee_count: o.estimated_num_employees, country: o.country, industry: o.industry }));
        const out = { companies, total: body?.pagination?.total_entries ?? null };
        return companies.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_results', output: out };
      },
      cost: costFromTable(PRICE.mixed_companies_search),
    },
    organizations_enrich: {
      description: 'Company profile by domain: name, LinkedIn, location, industry, headcount, funding, technologies.',
      normalize: (i) => ({ domain: String(i.domain ?? '').trim().toLowerCase() }),
      async execute(i, ctx) { // verify against docs
        const { status, body } = await httpJson(ctx, `${API}/organizations/enrich?domain=${encodeURIComponent(String(i.domain))}`, { headers: { 'cache-control': 'no-cache', 'x-api-key': env('APOLLO_API_KEY') ?? '' } });
        if (status === 404 || (status === 200 && !body?.organization)) return { status: 'miss', missReason: 'no_match', output: {} };
        if (status !== 200) return errorResult(status, body, body?.error ?? body?.message);
        const o = body.organization;
        return { status: 'hit', output: clean({ name: o.name, domain: o.primary_domain, linkedin_url: o.linkedin_url, country: o.country, city: o.city, industry: o.industry, estimated_num_employees: o.estimated_num_employees, founded_year: o.founded_year, total_funding: o.total_funding, latest_funding_stage: o.latest_funding_stage, latest_funding_round_date: o.latest_funding_round_date, technology_names: o.technology_names }) };
      },
      cost: costFromTable(PRICE.organizations_enrich),
    },
  },
});
