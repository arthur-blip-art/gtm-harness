import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { toE164 } from './_phone.ts';
import { env } from '../config.ts';
import { norm, normalizeLinkedin } from '../core/normalize.ts';

const CREDITS = { phone: 1, workEmail: 0.05 } as const;
type DataToGet = keyof typeof CREDITS;
const PRICE = { linkedin_profile: { basis: 'per_hit', credits: 1, note: '1 credit per phone revealed, 0.05 per work email; costOverride computed from dataToGet × what was actually returned' } } as const;

const dataToGet = (v: unknown): DataToGet[] => {
  const arr = Array.isArray(v) ? v : v ? [v] : ['workEmail'];
  const keep = [...new Set(arr.map(String))].filter((x): x is DataToGet => x in CREDITS).sort();
  return keep.length ? keep : ['workEmail'];
};

/** LinkedIn slug (`/in/<slug>`) is Kaspr's profile id. */
const slug = (url: string | null) => url?.split('/in/')[1]?.replace(/\/+$/, '') ?? '';

/**
 * Kaspr: reveal work email and/or phone from a LinkedIn profile. `dataToGet` picks what to reveal and drives the cost;
 * phones are 20x the price of a work email, so request them in a separate leg.
 */
export const kaspr = defineAdapter({
  name: 'kaspr',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['KASPR_API_KEY'],
  tools: {
    linkedin_profile: {
      description: 'Reveal work email and/or phone for a LinkedIn profile URL.',
      normalize: (i) => ({
        linkedin_url: normalizeLinkedin(i.linkedin_url) ?? '',
        ...(norm(i.name) ? { name: norm(i.name) } : {}),
        dataToGet: dataToGet(i.dataToGet),
      }),
      async execute(i, ctx) {
        const wants = i.dataToGet as DataToGet[];
        const id = slug(String(i.linkedin_url));
        if (!id) return { status: 'miss', missReason: 'no_linkedin_slug', output: {}, costOverride: 0 };
        const { status, body } = await httpJson(ctx, 'https://api.kaspr.io/profile/linkedin', { // verify against docs
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${env('KASPR_API_KEY') ?? ''}` },
          body: JSON.stringify({ id, ...(i.name ? { name: i.name } : {}), dataToGet: wants, isPhoneRequired: false }),
        });
        if (status === 404) return { status: 'miss', missReason: 'no_match', output: pick(body ?? {}, ['message']), costOverride: 0 };
        if (status !== 200) return errorResult(status, body, body?.message ?? body?.error);
        const p = body?.profile ?? body ?? {};
        const emails = ((p.workEmails ?? []) as any[]).map((e) => (typeof e === 'string' ? { email: e, valid: null } : { email: e.email ?? null, valid: e.valid ?? null })).filter((e) => e.email);
        const phones = ((p.phones ?? []) as any[]).map((ph) => (typeof ph === 'string' ? { phone: toE164(ph), raw: ph, phone_type: 'unknown' } : { phone: toE164(ph.number), raw: ph.number ?? null, phone_type: String(ph.type ?? 'unknown').toLowerCase() })).filter((ph) => ph.phone);
        const bestPhone = phones.find((ph) => ph.phone_type === 'mobile') ?? phones[0];
        const out = {
          email: emails[0]?.email ?? null,
          email_status: emails[0] ? (emails[0].valid === true ? 'valid' : emails[0].valid === false ? 'invalid' : 'unknown') : null,
          emails,
          phone: bestPhone?.phone ?? null,
          phone_type: bestPhone?.phone_type ?? null,
          phone_status: bestPhone ? 'found' : 'not_found',
          phones,
          linkedin_url: i.linkedin_url,
          ...pick(p, ['name', 'firstName', 'lastName', 'title', 'company']),
        };
        // Kaspr bills what it actually reveals: phone 1 credit, work email 0.05.
        const costOverride = (wants.includes('phone') && out.phone ? CREDITS.phone : 0) + (wants.includes('workEmail') && out.email ? CREDITS.workEmail : 0);
        const got = (wants.includes('workEmail') && !!out.email) || (wants.includes('phone') && !!out.phone);
        if (!got) return { status: 'miss', missReason: wants.length > 1 ? 'no_contact_point' : wants[0] === 'phone' ? 'no_phone_found' : 'no_email_found', output: out, costOverride: 0 };
        return { status: 'hit', output: out, costOverride };
      },
      cost: costFromTable(PRICE.linkedin_profile),
    },
  },
});
