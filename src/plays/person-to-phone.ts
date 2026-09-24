import { z } from 'zod';
import type { PhoneCell, Receipt, RowState } from '../core/types.ts';
import type { Leg } from '../core/waterfall.ts';
import type { PlayCtx } from '../core/play.ts';
import { defineRowPlay } from '../core/row-play.ts';
import { phonePolicy } from '../core/phone-policy.ts';
import { legEnabled } from './name-domain-to-email.ts';
import { apexDomain, normalizeLinkedin } from '../core/normalize.ts';
import type { Store } from '../store/store.ts';

export const NAME = 'person-to-phone';
export const DESCRIPTION = 'Direct/mobile phone from LinkedIn URL or name + domain. No validator yet: MEDIUM unless two providers agree.';
export const LEG_IDS = ['lusha', 'kaspr', 'fullenrich'];

export const Input = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  domain: z.string().optional(),
  linkedin_url: z.string().optional(),
  email: z.string().optional(),
}).refine((i) => i.linkedin_url || (i.first_name && i.last_name && i.domain), { message: 'linkedin_url or first_name+last_name+domain required' });
export type Input = z.infer<typeof Input>;

const onePhone = (rc: Receipt) => {
  const o = rc.output as any;
  return o?.phone ? [{ value: String(o.phone), rawStatus: o.phone_type ?? o.phone_status }] : [];
};

export function buildLegs(ctx: Pick<PlayCtx, 'dryRun' | 'legs'>): Leg[] {
  const leg = (id: string, provider: string, tool: string, buildInput: Leg['buildInput']): Leg => ({ id, provider, tool, enabled: legEnabled(ctx, provider, id), buildInput, extract: onePhone });
  const nameDomain = (r: RowState) => (r.input.first_name && r.input.last_name && r.input.domain ? { first_name: r.input.first_name, last_name: r.input.last_name, domain: r.input.domain } : null);
  return [
    leg('lusha', 'lusha', 'enrich_person', (r) => { const u = normalizeLinkedin(r.input.linkedin_url); const nd = nameDomain(r); return u ? { linkedin_url: u, reveal: 'phone', ...(nd ?? {}) } : nd ? { ...nd, reveal: 'phone' } : null; }),
    leg('kaspr', 'kaspr', 'linkedin_profile', (r) => { const u = normalizeLinkedin(r.input.linkedin_url); return u ? { linkedin_url: u, dataToGet: ['phone'] } : null; }),
    leg('fullenrich', 'fullenrich', 'bulk_enrich', (r) => { const nd = nameDomain(r); const u = normalizeLinkedin(r.input.linkedin_url); return nd ? { ...nd, ...(u ? { linkedin_url: u } : {}), enrich_fields: ['contact.phones'] } : null; }),
  ];
}

export async function steps(rows: RowState[], ctx: PlayCtx) {
  await ctx.waterfall(rows, buildLegs(ctx), phonePolicy);
}

export async function writeGolden(rows: RowState[], store: Store) {
  for (const r of rows) {
    const cell = r.cells.phone as PhoneCell | undefined;
    if (!cell?.value) continue;
    await store.upsertPerson({
      personKey: r.rowKey, firstName: r.input.first_name || undefined, lastName: r.input.last_name || undefined, domain: apexDomain(r.input.domain) ?? undefined,
      linkedinUrl: normalizeLinkedin(r.input.linkedin_url) ?? undefined, email: null, emailStatus: null, emailSource: null, confidence: 'LOW',
      phone: cell.value, phoneStatus: `${cell.status}:${cell.confidence}`, phoneSource: cell.source, fieldSources: { phone: cell.source ?? 'unknown' }, raw: {},
    });
  }
}

export const { scalar, batch } = defineRowPlay<Input, PhoneCell>({
  name: NAME, description: DESCRIPTION, input: Input, field: 'phone', legIds: LEG_IDS, steps, output: (r) => r.cells.phone as PhoneCell, golden: writeGolden,
});
