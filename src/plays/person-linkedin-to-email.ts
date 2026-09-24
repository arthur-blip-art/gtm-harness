import { z } from 'zod';
import type { EmailCell, LegCell, Receipt, RowState } from '../core/types.ts';
import type { Leg } from '../core/waterfall.ts';
import type { PlayCtx } from '../core/play.ts';
import { defineRowPlay } from '../core/row-play.ts';
import { emailPolicy } from '../core/email-policy.ts';
import { normalizeLinkedin, apexDomain } from '../core/normalize.ts';
import { legEnabled, verifyHeld } from './name-domain-to-email.ts';
import type { Store } from '../store/store.ts';

export const NAME = 'person-linkedin-to-email';
export const DESCRIPTION = 'Work email from a LinkedIn profile URL (domain optional, improves precision).';
export const LEG_IDS = ['prospeo', 'findymail', 'kaspr', 'lusha', 'apollo', 'pdl'];

export const Input = z.object({
  linkedin_url: z.string().min(1),
  domain: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});
export type Input = z.infer<typeof Input>;

const li = (r: RowState) => normalizeLinkedin(r.input.linkedin_url);
const oneEmail = (rc: Receipt) => {
  const o = rc.output as any;
  return o?.email ? [{ value: String(o.email), rawStatus: o.email_status }] : [];
};

export function buildLegs(ctx: Pick<PlayCtx, 'dryRun' | 'legs'>): Leg[] {
  const leg = (id: string, provider: string, tool: string, buildInput: Leg['buildInput']): Leg => ({ id, provider, tool, enabled: legEnabled(ctx, provider, id), buildInput, extract: oneEmail });
  const withDomain = (r: RowState, extra: Record<string, unknown> = {}) => { const u = li(r); return u ? { linkedin_url: u, ...(r.input.domain ? { domain: r.input.domain } : {}), ...extra } : null; };
  return [
    leg('prospeo', 'prospeo', 'enrich_person', (r) => { const u = li(r); return u ? { linkedin_url: u } : null; }),
    leg('findymail', 'findymail', 'find_from_linkedin', (r) => withDomain(r)),
    leg('kaspr', 'kaspr', 'linkedin_profile', (r) => withDomain(r, { dataToGet: ['workEmail'] })),
    leg('lusha', 'lusha', 'enrich_person', (r) => withDomain(r, { reveal: 'email' })),
    leg('apollo', 'apollo', 'people_match', (r) => { const u = li(r); return u && r.input.first_name && r.input.last_name ? { first_name: r.input.first_name, last_name: r.input.last_name, linkedin_url: u, ...(r.input.domain ? { domain: r.input.domain } : {}) } : (u ? { linkedin_url: u } : null); }),
    leg('pdl', 'peopledatalabs', 'person_enrich', (r) => withDomain(r)),
  ];
}

export async function steps(rows: RowState[], ctx: PlayCtx) {
  await ctx.waterfall(rows, buildLegs(ctx), emailPolicy);
  await verifyHeld(rows, ctx);
}

export async function writeGolden(rows: RowState[], store: Store) {
  for (const r of rows) {
    const email = r.cells.email as EmailCell | undefined;
    const domain = apexDomain(r.input.domain) ?? (email?.value ? apexDomain(email.value) : null);
    if (domain) await store.upsertCompany({ domain, fieldSources: {}, raw: {} });
    const raw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.cells)) if (k.startsWith('email_result__') && (v as LegCell).status === 'hit') raw[k.replace('email_result__', '')] = v;
    await store.upsertPerson({
      personKey: r.rowKey, firstName: r.input.first_name || undefined, lastName: r.input.last_name || undefined, domain: domain ?? undefined,
      linkedinUrl: li(r) ?? undefined, email: email?.value ?? null, emailStatus: email?.status ?? null, emailSource: email?.source ?? null,
      confidence: email?.confidence ?? 'LOW', fieldSources: email?.value ? { email: email.source ?? 'unknown', linkedin_url: 'csv' } : { linkedin_url: 'csv' }, raw,
    });
  }
}

export const { scalar, batch } = defineRowPlay<Input, EmailCell>({
  name: NAME, description: DESCRIPTION, input: Input, field: 'email', legIds: [...LEG_IDS, 'verify', 'zerobounce'], steps, output: (r) => r.cells.email as EmailCell, golden: writeGolden,
});
