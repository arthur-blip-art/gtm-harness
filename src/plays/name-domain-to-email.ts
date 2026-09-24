import { z } from 'zod';
import type { Candidate, EmailCell, EmailStatus, LegCell, LegMeta, Receipt, RowState } from '../core/types.ts';
import { registry, isConfigured } from '../providers/index.ts';
import type { Leg } from '../core/waterfall.ts';
import { cellOf } from '../core/waterfall.ts';
import type { PlayCtx } from '../core/play.ts';
import { defineRowPlay } from '../core/row-play.ts';
import { apexDomain, normalizeLinkedin } from '../core/normalize.ts';
import { canonicalStatus, decide, emailPolicy } from '../core/email-policy.ts';
import type { Store } from '../store/store.ts';

export const NAME = 'name-domain-to-email';
export const DESCRIPTION = 'Work email waterfall from first name + last name + domain (or company).';
export const LEG_IDS = ['pattern', 'hunter', 'leadmagic', 'findymail', 'prospeo', 'apollo', 'fullenrich', 'crustdata', 'pdl'];

const SOCIAL = /linkedin\.com|facebook\.com|twitter\.com|x\.com|crunchbase\.com|wikipedia\.org|glassdoor|indeed\.com|youtube\.com|instagram\.com/;

export const Input = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  domain: z.string().optional(),
  company: z.string().optional(),
  linkedin_url: z.string().optional(),
  title: z.string().optional(),
});
export type Input = z.infer<typeof Input>;

/** A leg is enabled when its key is configured (or in dry-run) and it is in the --legs subset when one is given. */
export function legEnabled(ctx: Pick<PlayCtx, 'dryRun' | 'legs'>, provider: string, id = provider): boolean {
  if (ctx.legs && !ctx.legs.includes(id)) return false;
  if (ctx.dryRun) return true;
  const a = registry[provider];
  return !!a && isConfigured(a);
}

const stdInput = (r: RowState) => {
  if (!r.input.first_name || !r.input.last_name || !r.input.domain) return null;
  const li = normalizeLinkedin(r.input.linkedin_url);
  return { first_name: r.input.first_name, last_name: r.input.last_name, domain: r.input.domain, ...(li ? { linkedin_url: li } : {}), ...(r.input.company ? { company: r.input.company } : {}) };
};
const nameDomainOnly = (r: RowState) => {
  const i = stdInput(r);
  return i ? { first_name: i.first_name, last_name: i.last_name, domain: i.domain } : null;
};
const oneEmail = (rc: Receipt) => {
  const o = rc.output as any;
  return o?.email ? [{ value: String(o.email), rawStatus: o.email_status ?? o.result }] : [];
};

/** Legs in order. Order IS the economics: cheapest and most precise first, PDL last. */
export function buildLegs(ctx: Pick<PlayCtx, 'dryRun' | 'legs'>): Leg[] {
  const leg = (id: string, provider: string, tool: string, buildInput: Leg['buildInput'], extract: Leg['extract'] = oneEmail): Leg =>
    ({ id, provider, tool, enabled: legEnabled(ctx, provider, id), buildInput, extract });
  return [
    leg('pattern', 'millionverifier', 'verify_patterns', nameDomainOnly),
    leg('hunter', 'hunter', 'email_finder', nameDomainOnly),
    leg('leadmagic', 'leadmagic', 'email_finder', nameDomainOnly),
    leg('findymail', 'findymail', 'find_from_name', nameDomainOnly),
    leg('prospeo', 'prospeo', 'enrich_person', stdInput),
    leg('apollo', 'apollo', 'people_match', stdInput),
    leg('fullenrich', 'fullenrich', 'bulk_enrich', stdInput),
    leg('crustdata', 'crustdata', 'person_enrich', (r) => { const li = normalizeLinkedin(r.input.linkedin_url); return li ? { linkedin_url: li } : null; }),
    leg('pdl', 'peopledatalabs', 'person_enrich', stdInput),
  ];
}

/** Rows with a company name but no domain: one cheap search, pick the first non-social result. */
export async function resolveDomains(rows: RowState[], ctx: PlayCtx): Promise<LegMeta> {
  const meta: LegMeta = { leg: 'resolve_domain', provider: 'exa', tool: 'search', rowsReached: 0, accepted: 0, receiptIds: [] };
  const todo = rows.filter((r) => !r.input.domain && r.input.company);
  if (!todo.length) return meta;
  if (!legEnabled(ctx, 'exa')) {
    ctx.log(`${todo.length} rows have a company but no domain and EXA_API_KEY is missing: they will be skipped`);
    return meta;
  }
  meta.rowsReached = todo.length;
  for (const r of todo) {
    const rc = await ctx.runner.execute({ provider: 'exa', tool: 'search', input: { query: `${r.input.company} official website`, numResults: 3 }, runId: ctx.runId });
    meta.receiptIds!.push(rc.id);
    if (!rc.cached) ctx.spent.credits += rc.costCredits;
    const results: { url: string }[] = (rc.output as any)?.results ?? [];
    const pick = results.find((x) => x.url && !SOCIAL.test(x.url));
    const apex = pick ? apexDomain(pick.url) : null;
    r.cells.domain_resolution = cellOf(apex ? 'hit' : 'miss', { value: apex ?? undefined, receiptId: rc.id, cached: rc.cached ?? false, costCredits: rc.cached ? 0 : rc.costCredits, missReason: apex ? undefined : 'no_website_found' });
    if (apex) { r.input.domain = apex; meta.accepted++; }
  }
  ctx.metas.push(meta);
  return meta;
}

/**
 * Validate once per final address, not during each leg: candidates left in HOLD get one
 * MillionVerifier check, then ZeroBounce as an independent second opinion for catch-alls.
 * `ok`/`valid` promotes to HIGH; two independent `catch_all` verdicts on the same address → MEDIUM.
 */
export async function verifyHeld(rows: RowState[], ctx: PlayCtx): Promise<LegMeta[]> {
  const out: LegMeta[] = [];
  for (const [id, provider, tool] of [['verify', 'millionverifier', 'verify'], ['zerobounce', 'zerobounce', 'validate']] as const) {
    const meta: LegMeta = { leg: id, provider, tool, rowsReached: 0, accepted: 0, receiptIds: [] };
    out.push(meta);
    ctx.metas.push(meta);
    if (!legEnabled(ctx, provider, id)) continue;
    const held = rows.filter((r) => (r.cells.email as EmailCell | undefined)?.confidence === 'HOLD');
    meta.rowsReached = held.length;
    for (const r of held) {
      const cell = r.cells.email as EmailCell;
      const rc = await ctx.runner.execute({ provider, tool, input: { email: cell.value }, runId: ctx.runId });
      meta.receiptIds!.push(rc.id);
      if (!rc.cached) ctx.spent.credits += rc.costCredits;
      const raw = (rc.output as any)?.result ?? (rc.output as any)?.email_status ?? (rc.output as any)?.status;
      const status = canonicalStatus(provider, raw);
      r.cells[`email_result__${id}`] = cellOf(rc.status === 'error' ? 'error' : rc.status, { value: cell.value ?? undefined, rawStatus: String(raw ?? ''), receiptId: rc.id, cached: rc.cached ?? false, costCredits: rc.cached ? 0 : rc.costCredits, missReason: rc.status === 'hit' ? undefined : String(raw ?? rc.error ?? '') });
      if (rc.status !== 'error') {
        const verified: Candidate<EmailStatus> = { value: cell.value!, status, rawStatus: String(raw ?? ''), source: `${cell.source}+${id}` };
        const list = (r.candidates.email ??= []) as Candidate<EmailStatus>[];
        list.unshift(verified);
        r.cells.email = decide(list, 1);
        if (status === 'valid') meta.accepted++;
      }
    }
  }
  return out;
}

export async function steps(rows: RowState[], ctx: PlayCtx): Promise<void> {
  await resolveDomains(rows, ctx);
  await ctx.waterfall(rows, buildLegs(ctx), emailPolicy);
  await verifyHeld(rows, ctx);
}

/** Golden records: precedence not averaging; every field names its source. */
export async function writeGolden(rows: RowState[], store: Store) {
  for (const r of rows) {
    const domain = apexDomain(r.input.domain);
    if (domain) await store.upsertCompany({ domain, name: r.input.company || undefined, fieldSources: r.input.company ? { name: 'csv' } : {}, raw: {} });
    const email = r.cells.email as EmailCell | undefined;
    const raw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.cells)) if (k.startsWith('email_result__') && (v as LegCell).status === 'hit') raw[k.replace('email_result__', '')] = v;
    await store.upsertPerson({
      personKey: r.rowKey, firstName: r.input.first_name || undefined, lastName: r.input.last_name || undefined,
      title: r.input.title || undefined, domain: domain ?? undefined, linkedinUrl: normalizeLinkedin(r.input.linkedin_url) ?? undefined,
      email: email?.value ?? null, emailStatus: email?.status ?? null, emailSource: email?.source ?? null, confidence: email?.confidence ?? 'LOW',
      fieldSources: email?.value ? { email: email.source ?? 'unknown', first_name: 'csv', last_name: 'csv' } : { first_name: 'csv', last_name: 'csv' }, raw,
    });
  }
}

export const { scalar, batch } = defineRowPlay<Input, EmailCell>({
  name: NAME, description: DESCRIPTION, input: Input, field: 'email', legIds: [...LEG_IDS, 'verify', 'zerobounce'],
  steps, output: (row) => row.cells.email as EmailCell, golden: writeGolden,
});
