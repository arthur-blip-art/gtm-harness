import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { toE164 } from './_phone.ts';
import { env } from '../config.ts';
import { nameToken, normalizeLinkedin } from '../core/normalize.ts';

const PRICE = { enrich_person: { basis: 'per_hit', credits: 1, note: '1 credit when at least one contact point is revealed; phones and emails revealed in the same call share it' } } as const;

type Reveal = 'email' | 'phone' | 'both';
const reveal = (v: unknown): Reveal => (v === 'email' || v === 'phone' ? v : 'both');

/**
 * Lusha person enrichment: emails with a confidence label, phones with a type and a doNotCall flag.
 * `reveal` controls which contact points are requested (both by default).
 */
export const lusha = defineAdapter({
  name: 'lusha',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['LUSHA_API_KEY'],
  tools: {
    enrich_person: {
      description: 'Reveal email and/or phone from first name + last name + company domain, or from a LinkedIn URL.',
      normalize: (i) => {
        const linkedin_url = normalizeLinkedin(i.linkedin_url);
        return {
          ...(linkedin_url ? { linkedin_url } : { first_name: nameToken(i.first_name), last_name: nameToken(i.last_name), ...pick(i, ['domain']) }),
          reveal: reveal(i.reveal),
        };
      },
      async execute(i, ctx) {
        const r = i.reveal as Reveal;
        const params = new URLSearchParams({ revealEmails: String(r !== 'phone'), revealPhones: String(r !== 'email') });
        if (i.linkedin_url) params.set('linkedinUrl', String(i.linkedin_url));
        else {
          params.set('firstName', String(i.first_name));
          params.set('lastName', String(i.last_name));
          params.set('companyDomain', String(i.domain ?? ''));
        }
        const { status, body } = await httpJson(ctx, `https://api.lusha.com/v2/person?${params}`, { headers: { api_key: env('LUSHA_API_KEY') ?? '' } }); // verify against docs
        if (status === 404) return { status: 'miss', missReason: 'no_match', output: pick(body ?? {}, ['message']) };
        if (status !== 200) return errorResult(status, body, body?.message ?? body?.error);
        const d = body?.data ?? body ?? {};
        const emails = ((d.emailAddresses ?? []) as any[]).map((e) => ({ email: e.email ?? e.address ?? null, email_status: e.emailConfidence ?? e.confidence ?? null, type: e.emailType ?? null })).filter((e) => e.email);
        const phones = ((d.phoneNumbers ?? []) as any[]).map((p) => ({ phone: toE164(p.number ?? p.internationalNumber), raw: p.number ?? null, phone_type: String(p.phoneType ?? p.type ?? 'unknown').toLowerCase(), do_not_call: p.doNotCall === true })).filter((p) => p.phone);
        const bestPhone = phones.find((p) => p.phone_type === 'mobile') ?? phones[0];
        const out = {
          email: emails[0]?.email ?? null,
          email_status: emails[0]?.email_status ?? null,
          emails,
          phone: bestPhone?.phone ?? null,
          phone_type: bestPhone?.phone_type ?? null,
          phone_status: bestPhone ? (bestPhone.do_not_call ? 'do_not_call' : 'found') : 'not_found',
          phones,
          ...pick(d, ['firstName', 'lastName', 'fullName', 'jobTitle', 'linkedinUrl']),
          company: pick(d.company ?? {}, ['name', 'domain', 'website']),
        };
        const wantEmail = r !== 'phone', wantPhone = r !== 'email';
        const got = (wantEmail && !!out.email) || (wantPhone && !!out.phone);
        if (!got) return { status: 'miss', missReason: wantEmail && wantPhone ? 'no_contact_point' : wantEmail ? 'no_email_found' : 'no_phone_found', output: out };
        return { status: 'hit', output: out };
      },
      cost: costFromTable(PRICE.enrich_person),
    },
  },
});
