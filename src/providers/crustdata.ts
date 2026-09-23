import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';

const PRICE = { person_enrich: { basis: 'per_result', credits: 1, note: 'billed per returned result; empty results free' } } as const;

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
  },
});
