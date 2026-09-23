import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import { nameToken } from '../core/normalize.ts';

const PRICE = { people_match: { basis: 'per_hit', credits: 1, note: '1 export credit when a net-new email is revealed; no charge on miss' } } as const;

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
  },
});
