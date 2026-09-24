import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import { apexDomain } from '../core/normalize.ts';

const BASE = 'https://predictleads.com/api/v3';
const PRICE = {
  financing_events: { basis: 'per_call', credits: 1, note: '1 credit per company lookup, empty result still billed' },
  job_openings: { basis: 'per_call', credits: 1, note: '1 credit per company lookup (limit 100), empty result still billed' },
} as const;

function headers() {
  return { 'X-Api-Key': env('PREDICTLEADS_API_KEY') ?? '', 'X-Api-Token': env('PREDICTLEADS_API_TOKEN') ?? '' };
}

/** PredictLeads: company signals keyed by domain (funding rounds, job openings). Two-part auth (key + token). */
export const predictleads = defineAdapter({
  name: 'predictleads',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['PREDICTLEADS_API_KEY', 'PREDICTLEADS_API_TOKEN'],
  tools: {
    financing_events: {
      description: 'Funding rounds for a company domain.',
      normalize: (i) => ({ domain: apexDomain(i.domain) ?? String(i.domain ?? '') }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/companies/${encodeURIComponent(String(i.domain))}/financing_events`, { headers: headers() }); // verify against docs
        if (status === 404) return { status: 'miss', missReason: 'company_not_found', output: { domain: i.domain, events: [] } };
        if (status !== 200) return errorResult(status, body, body?.error ?? body?.message);
        const rows: any[] = body?.data ?? [];
        const events = rows.map((e) => ({ id: e.id ?? null, ...pick(e.attributes ?? {}, ['amount', 'currency', 'date', 'financing_type', 'categories', 'article_title', 'article_url']) }));
        const out = { domain: i.domain, events };
        return events.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_events', output: out };
      },
      cost: costFromTable(PRICE.financing_events),
    },
    job_openings: {
      description: 'Open job postings for a company domain (up to 100).',
      normalize: (i) => ({ domain: apexDomain(i.domain) ?? String(i.domain ?? '') }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/companies/${encodeURIComponent(String(i.domain))}/job_openings?limit=100`, { headers: headers() }); // verify against docs
        if (status === 404) return { status: 'miss', missReason: 'company_not_found', output: { domain: i.domain, jobs: [] } };
        if (status !== 200) return errorResult(status, body, body?.error ?? body?.message);
        const rows: any[] = body?.data ?? [];
        const jobs = rows.map((j) => ({ id: j.id ?? null, ...pick(j.attributes ?? {}, ['title', 'first_seen_at', 'last_seen_at', 'categories', 'url', 'location', 'seniority']) }));
        const out = { domain: i.domain, jobs };
        return jobs.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_jobs', output: out };
      },
      cost: costFromTable(PRICE.job_openings),
    },
  },
});
