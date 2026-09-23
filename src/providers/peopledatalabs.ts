import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import { nameToken } from '../core/normalize.ts';

const PRICE = { person_enrich: { basis: 'per_hit', credits: 3, note: 'bills only on 200; x-call-credits-spent header is authoritative' } } as const;

/** People Data Labs person enrichment. Expensive: last leg only. Emails are not verified by PDL → status unknown. */
export const peopledatalabs = defineAdapter({
  name: 'peopledatalabs',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-23 (estimate, check your plan)', table: PRICE },
  requiredEnv: ['PDL_API_KEY'],
  tools: {
    person_enrich: {
      description: 'Enrich a person from name + company domain, requiring a work email.',
      normalize: (i) => ({ first_name: nameToken(i.first_name), last_name: nameToken(i.last_name), ...pick(i, ['domain', 'linkedin_url']) }),
      async execute(i, ctx) {
        const params = new URLSearchParams({ min_likelihood: '6', required: 'work_email', pretty: 'false' });
        if (i.linkedin_url) params.set('profile', String(i.linkedin_url));
        else {
          params.set('first_name', String(i.first_name));
          params.set('last_name', String(i.last_name));
          params.set('company', String(i.domain));
        }
        const { status, body, headers } = await httpJson(ctx, `https://api.peopledatalabs.com/v5/person/enrich?${params}`, {
          headers: { 'X-Api-Key': env('PDL_API_KEY') ?? '' },
        });
        const spent = Number(headers.get('x-call-credits-spent') ?? NaN);
        const costOverride = Number.isFinite(spent) ? spent : undefined;
        if (status === 404) return { status: 'miss', missReason: 'no_match', output: pick(body ?? {}, ['status', 'error']), costOverride: costOverride ?? 0 };
        if (status !== 200) return errorResult(status, body, body?.error?.message);
        const d = body.data ?? {};
        const out = { ...pick(d, ['work_email', 'linkedin_url', 'job_title', 'job_company_website', 'full_name']), likelihood: body.likelihood };
        if (!d.work_email) return { status: 'miss', missReason: 'no_work_email', output: out, costOverride };
        return { status: 'hit', output: { ...out, email: d.work_email, email_status: 'unknown' }, costOverride };
      },
      cost: costFromTable(PRICE.person_enrich),
    },
  },
});
