import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import { normalizeEmail } from '../core/normalize.ts';

const PRICE = { validate: { basis: 'per_call', credits: 1, note: '1 credit per validation, whatever the verdict' } } as const;

/**
 * ZeroBounce single-email validation. Verdicts: valid | invalid | catch-all | unknown | spamtrap | abuse | do_not_mail.
 * Hit = usable verdict (valid or catch-all); anything else is a miss with the status as reason.
 * Key travels in the query string — never log the URL.
 */
export const zerobounce = defineAdapter({
  name: 'zerobounce',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['ZEROBOUNCE_API_KEY'],
  tools: {
    validate: {
      description: 'Validate one email address (status + sub_status).',
      normalize: (i) => ({ email: normalizeEmail(i.email) ?? '' }),
      async execute(i, ctx) {
        const params = new URLSearchParams({ api_key: env('ZEROBOUNCE_API_KEY') ?? '', email: String(i.email), ip_address: '' });
        const { status, body } = await httpJson(ctx, `https://api.zerobounce.net/v2/validate?${params}`); // verify against docs
        if (status !== 200) return errorResult(status, body, body?.error ?? body?.message);
        if (body?.error) return errorResult(200, body, String(body.error)); // ZeroBounce returns 200 + {error} on bad key / no credits
        const raw = String(body?.status ?? 'unknown').toLowerCase();
        const email_status = raw.replace(/-/g, '_'); // catch-all → catch_all
        const out = {
          email: body?.address ?? i.email,
          email_status,
          sub_status: body?.sub_status ?? null,
          ...pick(body ?? {}, ['free_email', 'mx_found', 'mx_record', 'smtp_provider', 'domain', 'did_you_mean', 'firstname', 'lastname', 'processed_at']),
        };
        const usable = email_status === 'valid' || email_status === 'catch_all';
        return usable ? { status: 'hit', output: out } : { status: 'miss', missReason: email_status, output: out };
      },
      cost: costFromTable(PRICE.validate),
    },
  },
});
