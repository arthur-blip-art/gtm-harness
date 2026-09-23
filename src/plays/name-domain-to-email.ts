import type { EmailCandidate, EmailCell, LegCell, Receipt, RowState } from '../core/types.ts';
import { registry, isConfigured } from '../providers/index.ts';
import type { Leg } from '../core/waterfall.ts';
import { runWaterfall } from '../core/waterfall.ts';
import type { ToolRunner } from '../core/tools.ts';
import type { LegMeta } from '../core/receipt.ts';
import { apexDomain, normalizeLinkedin } from '../core/normalize.ts';
import { canonicalStatus, decide } from '../core/email-policy.ts';
import type { Store } from '../store/store.ts';

export const NAME = 'name-domain-to-email';
export const DESCRIPTION = 'Work email waterfall from first name + last name + domain (or company).';

const SOCIAL = /linkedin\.com|facebook\.com|twitter\.com|x\.com|crunchbase\.com|wikipedia\.org|glassdoor|indeed\.com|youtube\.com|instagram\.com/;

export interface PlayOpts {
  runId: string;
  dryRun: boolean;
  legs?: string[];
  maxCredits?: number;
  log: (msg: string) => void;
  onRowUpdated?: (row: RowState) => Promise<void> | void;
}

function enabled(provider: string, dryRun: boolean, wanted?: string[], id?: string): boolean {
  if (wanted && !wanted.includes(id ?? provider)) return false;
  return dryRun || isConfigured(registry[provider]);
}

/** Legs in order. Order IS the economics: cheapest and most precise first, PDL last. */
export function buildLegs(opts: PlayOpts): Leg[] {
  const std = (r: RowState) => (r.input.first_name && r.input.last_name && r.input.domain
    ? { first_name: r.input.first_name, last_name: r.input.last_name, domain: r.input.domain, ...(normalizeLinkedin(r.input.linkedin_url) ? { linkedin_url: normalizeLinkedin(r.input.linkedin_url) } : {}) }
    : null);
  const one = (rc: Receipt) => {
    const o = rc.output as any;
    return o?.email ? [{ email: String(o.email), rawStatus: o.email_status ?? o.result }] : [];
  };
  return [
    { id: 'pattern', provider: 'millionverifier', tool: 'verify_patterns', enabled: enabled('millionverifier', opts.dryRun, opts.legs, 'pattern'),
      buildInput: (r) => { const i = std(r); if (!i) return null; const { linkedin_url: _l, ...rest } = i; return rest; }, extract: one },
    { id: 'apollo', provider: 'apollo', tool: 'people_match', enabled: enabled('apollo', opts.dryRun, opts.legs), buildInput: std, extract: one },
    { id: 'fullenrich', provider: 'fullenrich', tool: 'bulk_enrich', enabled: enabled('fullenrich', opts.dryRun, opts.legs), buildInput: std, extract: one },
    { id: 'crustdata', provider: 'crustdata', tool: 'person_enrich', enabled: enabled('crustdata', opts.dryRun, opts.legs),
      buildInput: (r) => { const li = normalizeLinkedin(r.input.linkedin_url); return li ? { linkedin_url: li } : null; }, extract: one },
    { id: 'pdl', provider: 'peopledatalabs', tool: 'person_enrich', enabled: enabled('peopledatalabs', opts.dryRun, opts.legs), buildInput: std, extract: one },
  ];
}

export const LEG_IDS = ['pattern', 'apollo', 'fullenrich', 'crustdata', 'pdl'];

/** Rows with a company name but no domain: one cheap search, pick the first non-social result. */
export async function resolveDomains(rows: RowState[], runner: ToolRunner, opts: PlayOpts): Promise<LegMeta> {
  const meta: LegMeta = { leg: 'resolve_domain', provider: 'exa', tool: 'search', rowsReached: 0, accepted: 0 };
  const todo = rows.filter((r) => !r.input.domain && r.input.company);
  if (!todo.length) return meta;
  if (!enabled('exa', opts.dryRun)) {
    opts.log(`${todo.length} rows have a company but no domain and EXA_API_KEY is missing: they will be skipped`);
    return meta;
  }
  meta.rowsReached = todo.length;
  for (const r of todo) {
    const rc = await runner.execute({ provider: 'exa', tool: 'search', input: { query: `${r.input.company} official website`, numResults: 3 }, runId: opts.runId });
    const results: { url: string }[] = (rc.output as any)?.results ?? [];
    const pick = results.find((x) => x.url && !SOCIAL.test(x.url));
    const apex = pick ? apexDomain(pick.url) : null;
    r.cells.domain_resolution = { status: apex ? 'hit' : 'miss', value: apex ?? undefined, receiptId: rc.id, cached: rc.cached ?? false, costCredits: rc.cached ? 0 : rc.costCredits, at: new Date().toISOString(), missReason: apex ? undefined : 'no_website_found' };
    if (apex) { r.input.domain = apex; meta.accepted++; }
  }
  return meta;
}

/**
 * Validate once per final address, not during each leg: candidates left in HOLD (unknown /
 * lone catch_all) get one verifier call. A `valid` verdict promotes them to HIGH.
 */
export async function verifyHeld(rows: RowState[], runner: ToolRunner, opts: PlayOpts): Promise<LegMeta> {
  const meta: LegMeta = { leg: 'verify', provider: 'millionverifier', tool: 'verify', rowsReached: 0, accepted: 0 };
  if (!enabled('millionverifier', opts.dryRun, opts.legs, 'verify')) return meta;
  const held = rows.filter((r) => (r.cells.email as EmailCell)?.confidence === 'HOLD');
  meta.rowsReached = held.length;
  for (const r of held) {
    const cell = r.cells.email as EmailCell;
    const rc = await runner.execute({ provider: 'millionverifier', tool: 'verify', input: { email: cell.value }, runId: opts.runId });
    const result = (rc.output as any)?.result;
    const status = canonicalStatus('millionverifier', result);
    r.cells.email_result__verify = { status: rc.status === 'error' ? 'error' : rc.status, value: cell.value ?? undefined, rawStatus: result, receiptId: rc.id, cached: rc.cached ?? false, costCredits: rc.cached ? 0 : rc.costCredits, at: new Date().toISOString(), missReason: rc.status === 'hit' ? undefined : String(result ?? rc.error) } satisfies LegCell;
    if (rc.status !== 'error') {
      const verified: EmailCandidate = { email: cell.value!, status, rawStatus: result, source: `${cell.source}+verify` };
      r.candidates = [verified, ...r.candidates.filter((c) => c.email !== cell.value)];
      r.cells.email = decide(r.candidates, 1);
      if (status === 'valid') meta.accepted++;
    }
    await opts.onRowUpdated?.(r);
  }
  return meta;
}

export async function run(rows: RowState[], runner: ToolRunner, opts: PlayOpts): Promise<LegMeta[]> {
  const resolve = await resolveDomains(rows, runner, opts);
  const legs = buildLegs(opts);
  const metas = await runWaterfall(rows, legs, runner, { runId: opts.runId, maxCredits: opts.maxCredits, log: opts.log, onRowUpdated: opts.onRowUpdated });
  metas.push(await verifyHeld(rows, runner, opts));
  return [resolve, ...metas];
}

/** Golden records: precedence not averaging; every field names its source. */
export async function writeGolden(rows: RowState[], store: Store) {
  for (const r of rows) {
    const domain = apexDomain(r.input.domain);
    if (domain) await store.upsertCompany({ domain, name: r.input.company || undefined, fieldSources: r.input.company ? { name: 'csv' } : {}, raw: {} });
    const email = r.cells.email as EmailCell;
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
