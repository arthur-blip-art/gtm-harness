import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import { norm, normalizeEmail, normalizeLinkedin } from '../core/normalize.ts';
import type { AdapterCtx, ToolResult } from '../core/types.ts';

const BASE = 'https://app.findymail.com/api';
const PRICE = {
  find_from_name: { basis: 'per_hit', credits: 1, note: '1 credit per email found; no charge on miss' },
  find_from_linkedin: { basis: 'per_hit', credits: 1, note: '1 credit per email found; no charge on miss' },
  verify: { basis: 'per_hit', credits: 1, note: 'charged only when the address verifies (per Findymail); counted per hit' },
} as const;

function headers() {
  return { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${env('FINDYMAIL_API_KEY') ?? ''}` };
}

/** Display name "First Last" (keeps spaces, lowercases; Findymail matches loosely). */
function fullName(i: Record<string, unknown>): string {
  const n = norm(i.name);
  if (n) return n;
  return `${norm(i.first_name)} ${norm(i.last_name)}`.trim();
}

function contactResult(status: number, body: any): ToolResult {
  if (status === 404) return { status: 'miss', missReason: 'no_match', output: pick(body ?? {}, ['message']) };
  if (status !== 200) return errorResult(status, body, body?.message ?? body?.error);
  const c = body?.contact ?? {};
  const out = {
    email: c.email ?? null,
    // Findymail only returns emails it verified; `verified` is not always present in the payload. // verify against docs
    email_status: c.email ? (c.verified === false ? 'unknown' : 'valid') : null,
    ...pick(c, ['name', 'domain', 'linkedin_url', 'job_title', 'company']),
  };
  if (!c.email) return { status: 'miss', missReason: 'no_email_found', output: out };
  return { status: 'hit', output: out };
}

async function post(ctx: AdapterCtx, path: string, body: unknown) {
  return httpJson(ctx, `${BASE}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
}

/** Findymail: finder + verifier; found emails are pre-verified, so a Findymail hit rarely needs a second validator. */
export const findymail = defineAdapter({
  name: 'findymail',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['FINDYMAIL_API_KEY'],
  tools: {
    find_from_name: {
      description: 'Find a verified work email from full name + domain.',
      normalize: (i) => ({ name: fullName(i), ...pick(i, ['domain']) }),
      async execute(i, ctx) {
        const { status, body } = await post(ctx, '/search/name', { name: i.name, domain: i.domain }); // verify against docs
        return contactResult(status, body);
      },
      cost: costFromTable(PRICE.find_from_name),
    },
    find_from_linkedin: {
      description: 'Find a verified work email from a LinkedIn profile URL.',
      normalize: (i) => ({ linkedin_url: normalizeLinkedin(i.linkedin_url) ?? '' }),
      async execute(i, ctx) {
        const { status, body } = await post(ctx, '/search/linkedin', { linkedin_url: i.linkedin_url }); // verify against docs
        return contactResult(status, body);
      },
      cost: costFromTable(PRICE.find_from_linkedin),
    },
    verify: {
      description: 'Verify one email address (boolean verdict).',
      normalize: (i) => ({ email: normalizeEmail(i.email) ?? '' }),
      async execute(i, ctx) {
        const { status, body } = await post(ctx, '/verify', { email: i.email }); // verify against docs
        if (status !== 200) return errorResult(status, body, body?.message ?? body?.error);
        const verified = body?.verified === true;
        const out = { email: body?.email ?? i.email, email_status: verified ? 'valid' : 'invalid', verified, ...pick(body ?? {}, ['provider']) };
        return verified ? { status: 'hit', output: out } : { status: 'miss', missReason: 'invalid', output: out };
      },
      cost: costFromTable(PRICE.verify),
    },
  },
});
