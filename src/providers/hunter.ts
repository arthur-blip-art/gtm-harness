import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import { nameToken, normalizeEmail } from '../core/normalize.ts';

const BASE = 'https://api.hunter.io/v2';
const PRICE = {
  email_finder: { basis: 'per_hit', credits: 1, note: '1 request credit when an email is returned; no charge on miss' },
  email_verifier: { basis: 'per_call', credits: 1, note: '1 verification credit per call, whatever the verdict' },
  email_count: { basis: 'free', credits: 0, note: 'free endpoint, no key consumption' },
} as const;

function auth(): string {
  return `api_key=${encodeURIComponent(env('HUNTER_API_KEY') ?? '')}`;
}

/**
 * Hunter.io. Email finder returns one guessed/verified email with a confidence score; verifier gives a deliverability verdict.
 * Coverage is thin below ~50 employees. Key travels in the query string (Hunter has no header auth) — never log the URL.
 */
export const hunter = defineAdapter({
  name: 'hunter',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['HUNTER_API_KEY'],
  tools: {
    email_finder: {
      description: 'Find the most likely work email from first name + last name + domain.',
      normalize: (i) => ({ first_name: nameToken(i.first_name), last_name: nameToken(i.last_name), ...pick(i, ['domain']) }),
      async execute(i, ctx) {
        const params = new URLSearchParams({ domain: String(i.domain), first_name: String(i.first_name), last_name: String(i.last_name) });
        const { status, body } = await httpJson(ctx, `${BASE}/email-finder?${params}&${auth()}`); // verify against docs
        if (status !== 200) return errorResult(status, body, body?.errors?.[0]?.details);
        const d = body?.data ?? {};
        const out = {
          email: d.email ?? null,
          email_status: d.verification?.status ?? null, // valid|invalid|accept_all|webmail|disposable|unknown (or null when not verified)
          score: d.score ?? null,
          ...pick(d, ['first_name', 'last_name', 'position', 'domain', 'company', 'linkedin_url']),
          verification: pick(d.verification ?? {}, ['date', 'status']),
        };
        if (!d.email) return { status: 'miss', missReason: 'no_email_found', output: out };
        return { status: 'hit', output: out };
      },
      cost: costFromTable(PRICE.email_finder),
    },
    email_verifier: {
      description: 'Verify one email address (deliverability verdict + score).',
      normalize: (i) => ({ email: normalizeEmail(i.email) ?? '' }),
      async execute(i, ctx) {
        const params = new URLSearchParams({ email: String(i.email) });
        const { status, body } = await httpJson(ctx, `${BASE}/email-verifier?${params}&${auth()}`); // verify against docs
        if (status !== 200) return errorResult(status, body, body?.errors?.[0]?.details);
        const d = body?.data ?? {};
        const email_status = String(d.status ?? 'unknown').toLowerCase();
        const out = {
          email: d.email ?? i.email,
          email_status, // valid|invalid|accept_all|webmail|disposable|unknown
          result: d.result ?? null, // deliverable|undeliverable|risky
          score: d.score ?? null,
          ...pick(d, ['regexp', 'gibberish', 'disposable', 'webmail', 'mx_records', 'smtp_server', 'smtp_check', 'accept_all', 'block']),
        };
        // Only `valid` is a sendable verdict; everything else is a miss with the raw status as reason.
        return email_status === 'valid' ? { status: 'hit', output: out } : { status: 'miss', missReason: email_status, output: out };
      },
      cost: costFromTable(PRICE.email_verifier),
    },
    email_count: {
      description: 'Count how many emails Hunter has indexed for a domain (free coverage check before spending on the finder).',
      normalize: (i) => ({ ...pick(i, ['domain']) }),
      async execute(i, ctx) {
        const params = new URLSearchParams({ domain: String(i.domain) });
        const { status, body } = await httpJson(ctx, `${BASE}/email-count?${params}&${auth()}`); // verify against docs
        if (status !== 200) return errorResult(status, body, body?.errors?.[0]?.details);
        const d = body?.data ?? {};
        const total = Number(d.total ?? 0);
        const out = { domain: i.domain, total, ...pick(d, ['personal_emails', 'generic_emails', 'department', 'seniority']) };
        return total > 0 ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_emails_indexed', output: out };
      },
      cost: costFromTable(PRICE.email_count),
    },
  },
});
