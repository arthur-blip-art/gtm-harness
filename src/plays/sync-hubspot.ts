import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { hashInput } from '../core/hash.ts';
import { legEnabled } from './name-domain-to-email.ts';
import type { LegMeta } from '../core/types.ts';
import type { CompanyRow, PersonRow } from '../store/store.ts';

export const NAME = 'sync-hubspot';
export const DESCRIPTION = 'Upsert companies (by domain) and contacts (by email) into HubSpot. Only HIGH/MEDIUM emails, never do_not_contact; unchanged records are skipped by hash.';

export const Input = z.object({
  domains: z.array(z.string()).optional(),
  dry_run: z.boolean().default(false).describe('compute what would change without calling HubSpot'),
});
export type Input = z.infer<typeof Input>;
export interface Output { created: number; updated: number; skipped: number; excluded: number; errors: string[]; dry_run: boolean }

function companyProps(c: CompanyRow) {
  return { domain: c.domain, name: c.name, country: c.country, city: c.city, industry: c.industry, numberofemployees: c.headcount, founded_year: c.foundedYear } as Record<string, unknown>;
}
function contactProps(p: PersonRow) {
  return { email: p.email, firstname: p.firstName, lastname: p.lastName, jobtitle: p.title, phone: p.phone ?? undefined, hs_linkedin_url: p.linkedinUrl, gtm_confidence: p.confidence, gtm_email_source: p.emailSource } as Record<string, unknown>;
}
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const out: Output = { created: 0, updated: 0, skipped: 0, excluded: 0, errors: [], dry_run: input.dry_run };
    if (!input.dry_run && !legEnabled(ctx, 'hubspot')) throw new Error('HUBSPOT_TOKEN is not configured (use dry_run to preview)');
    const companies = await ctx.store.listCompanies(input.domains);
    const people = (await ctx.store.listPeople(input.domains)).filter((p) => {
      const ok = p.email && ['HIGH', 'MEDIUM'].includes(p.confidence) && !p.doNotContact;
      if (!ok) out.excluded++;
      return ok;
    });
    const meta: LegMeta = { leg: 'hubspot_upsert', provider: 'hubspot', tool: 'batch_upsert', rowsReached: companies.length + people.length, accepted: 0, receiptIds: [] };
    ctx.metas.push(meta);

    const upsert = async (objectType: 'companies' | 'contacts', idProperty: 'domain' | 'email', items: Array<{ entityId: string; id: string; properties: Record<string, unknown> }>) => {
      const todo: typeof items = [];
      for (const it of items) {
        const hash = hashInput(it.properties);
        const prev = await ctx.store.getCrmSync(objectType === 'companies' ? 'company' : 'person', it.entityId, 'hubspot');
        if (prev?.lastHash === hash && prev.crmId) { out.skipped++; continue; }
        todo.push({ ...it, properties: { ...it.properties, __hash: hash, __isNew: !prev?.crmId } });
      }
      for (let i = 0; i < todo.length; i += 100) {
        const chunk = todo.slice(i, i + 100);
        if (input.dry_run) { for (const c of chunk) (c.properties.__isNew ? out.created++ : out.updated++); continue; }
        const rc = await ctx.runner.execute({ provider: 'hubspot', tool: 'batch_upsert', input: { objectType, idProperty, inputs: chunk.map((c) => ({ id: c.id, properties: clean(stripMeta(c.properties)) })) }, runId: ctx.runId });
        meta.receiptIds!.push(rc.id);
        if (rc.status === 'error') { out.errors.push(`${objectType}: ${rc.error}`); continue; }
        const results: Array<{ id: string; properties?: Record<string, unknown> }> = (rc.output as any)?.results ?? [];
        for (let k = 0; k < chunk.length; k++) {
          const c = chunk[k];
          const res = results[k] ?? results.find((r) => String(r.properties?.[idProperty] ?? '').toLowerCase() === c.id.toLowerCase());
          if (!res) { out.errors.push(`${objectType}:${c.id} not in response`); continue; }
          c.properties.__isNew ? out.created++ : out.updated++;
          meta.accepted++;
          await ctx.store.upsertCrmSync({ entityType: objectType === 'companies' ? 'company' : 'person', entityId: c.entityId, crm: 'hubspot', crmObjectType: objectType, crmId: res.id, lastHash: String(c.properties.__hash), lastSyncedAt: new Date().toISOString(), status: 'ok' });
        }
      }
    };
    await upsert('companies', 'domain', companies.map((c) => ({ entityId: c.domain, id: c.domain, properties: clean(companyProps(c)) })));
    await upsert('contacts', 'email', people.map((p) => ({ entityId: p.personKey, id: p.email!, properties: clean(contactProps(p)) })));
    return out;
  },
});

const stripMeta = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('__')));
