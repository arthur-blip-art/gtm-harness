import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { toE164 } from './_phone.ts';
import { env } from '../config.ts';
import { nameToken, normalizeEmail, normalizeLinkedin } from '../core/normalize.ts';

const BASE = 'https://api.leadmagic.io';
const PRICE = {
  email_finder: { basis: 'per_hit', credits: 1, note: 'credits_consumed from the response is authoritative (costOverride)' },
  email_validation: { basis: 'per_call', credits: 0.05, note: 'credits_consumed from the response is authoritative (costOverride)' },
  mobile_finder: { basis: 'per_hit', credits: 5, note: 'credits_consumed from the response is authoritative (costOverride); mobiles are expensive' },
} as const;

function headers() {
  return { 'content-type': 'application/json', 'X-API-Key': env('LEADMAGIC_API_KEY') ?? '' };
}

function spent(body: any): number | undefined {
  const n = Number(body?.credits_consumed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * LeadMagic. Finder returns an email with its validation status in one call; the validator exposes `mx_record`.
 * `invalid` + populated `mx_record` means the mailbox could not be proven (not that it does not exist) → escalate to a second validator.
 */
export const leadmagic = defineAdapter({
  name: 'leadmagic',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['LEADMAGIC_API_KEY'],
  tools: {
    email_finder: {
      description: 'Find a work email from first name + last name + domain; status comes back with it.',
      normalize: (i) => ({ first_name: nameToken(i.first_name), last_name: nameToken(i.last_name), ...pick(i, ['domain']) }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/email-finder`, { // verify against docs
          method: 'POST', headers: headers(), body: JSON.stringify({ first_name: i.first_name, last_name: i.last_name, domain: i.domain }),
        });
        if (status !== 200) return errorResult(status, body, body?.message ?? body?.error);
        const email_status = String(body?.status ?? 'unknown').toLowerCase(); // valid|catch_all|unknown|not_found
        const out = {
          email: body?.email ?? null,
          email_status,
          credits_consumed: body?.credits_consumed ?? null,
          ...pick(body ?? {}, ['first_name', 'last_name', 'domain', 'company_name', 'mx_provider', 'is_domain_catch_all']),
        };
        const costOverride = spent(body);
        if (!body?.email || email_status === 'not_found') return { status: 'miss', missReason: body?.email ? email_status : 'no_email_found', output: out, costOverride };
        return { status: 'hit', output: out, costOverride };
      },
      cost: costFromTable(PRICE.email_finder),
    },
    email_validation: {
      description: 'Validate one email; exposes mx_record so an unprovable mailbox can be escalated.',
      normalize: (i) => ({ email: normalizeEmail(i.email) ?? '' }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/email-validate`, { // verify against docs
          method: 'POST', headers: headers(), body: JSON.stringify({ email: i.email }),
        });
        if (status !== 200) return errorResult(status, body, body?.message ?? body?.error);
        const email_status = String(body?.email_status ?? 'unknown').toLowerCase(); // valid|invalid|catch_all|unknown
        const mx_record = body?.mx_record ?? null;
        // invalid + mx_record populated: LeadMagic could not prove the mailbox; a second validator may still say valid.
        const needs_second_validator = email_status === 'invalid' && !!mx_record;
        const out = {
          email: body?.email ?? i.email,
          email_status,
          mx_record,
          needs_second_validator,
          credits_consumed: body?.credits_consumed ?? null,
          ...pick(body ?? {}, ['mx_provider', 'is_domain_catch_all', 'is_role_account', 'is_free_email', 'company_name']),
        };
        const costOverride = spent(body);
        const usable = email_status === 'valid' || email_status === 'catch_all';
        return usable ? { status: 'hit', output: out, costOverride } : { status: 'miss', missReason: email_status, output: out, costOverride };
      },
      cost: costFromTable(PRICE.email_validation),
    },
    mobile_finder: {
      description: 'Find a mobile number from a LinkedIn profile URL or a work email.',
      normalize: (i) => ({
        ...(normalizeLinkedin(i.profile_url ?? i.linkedin_url) ? { profile_url: normalizeLinkedin(i.profile_url ?? i.linkedin_url) } : {}),
        ...(normalizeEmail(i.work_email ?? i.email) ? { work_email: normalizeEmail(i.work_email ?? i.email) } : {}),
      }),
      async execute(i, ctx) {
        if (!i.profile_url && !i.work_email) return { status: 'miss', missReason: 'no_identifier', output: {}, costOverride: 0 };
        const { status, body } = await httpJson(ctx, `${BASE}/mobile-finder`, { // verify against docs
          method: 'POST', headers: headers(), body: JSON.stringify(pick(i, ['profile_url', 'work_email'])),
        });
        if (status !== 200) return errorResult(status, body, body?.message ?? body?.error);
        const raw = body?.mobile_number ?? null;
        const phone = toE164(raw);
        const out = {
          phone,
          phone_status: raw ? 'found' : 'not_found',
          phone_type: 'mobile',
          mobile_number: raw,
          credits_consumed: body?.credits_consumed ?? null,
          ...pick(body ?? {}, ['message']),
        };
        const costOverride = spent(body);
        if (!phone) return { status: 'miss', missReason: 'no_mobile_found', output: out, costOverride };
        return { status: 'hit', output: out, costOverride };
      },
      cost: costFromTable(PRICE.mobile_finder),
    },
  },
});
