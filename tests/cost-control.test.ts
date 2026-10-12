import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { registry } from '../src/providers/index.ts';
import { estimateRun } from '../src/core/estimate.ts';
import { unitUsd } from '../src/core/budget.ts';
import { disqualify, type Output as ProspectOutput } from '../src/plays/prospect.ts';
import type { BatchOutput } from '../src/core/row-play.ts';
import type { EmailCell } from '../src/core/types.ts';

const quiet = () => {};
const OFFER = 'We give B2B teams the accounts and contacts that match their ICP, cheapest source first.';
const rows = (n: number, last: (k: number) => string) => Array.from({ length: n }, (_, k) => ({ first_name: `Ann${k}`, last_name: last(k), domain: `co${k}.io` }));

describe('every provider call a play makes exists in the real adapter, with a price', () => {
  it('replays the plays in dry-run and checks each (provider, tool) against the real registry', async () => {
    const store = new MemoryStore();
    const run = (play: string, input: unknown) => executePlay({ store, resolvePlay, play: resolvePlay(play), input, dryRun: true, log: quiet });
    await run('prospect', { countries: ['FR'], seed_domains: ['lemlist.com'], titles: ['VP Sales', 'CEO'], offer: OFFER, accounts: 2, out_dir: fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-')) });
    await run('icp-to-companies', { countries: ['FR'], limit: 3, public_first: false });
    await run('company-enrich', { domain: 'acme.io' });
    await run('company-signals', { domain: 'acme.io', paid: 'always' });
    await run('company-to-people', { domain: 'acme.io', titles: ['CTO'], limit: 5 });
    await run('person-to-phone', { first_name: 'Ann', last_name: 'Lee', domain: 'acme.io' });
    await run('person-to-linkedin', { first_name: 'Ann', last_name: 'Lee', company: 'Acme' });
    await run('person-linkedin-to-email', { linkedin_url: 'https://www.linkedin.com/in/ann-lee' });
    await run('social-listening', { terms: ['Clay'], x_handles: ['clayhq'] });
    await run('linkedin-signals', { keywords: ['crm'], competitors: ['https://www.linkedin.com/company/x'], profiles: ['https://www.linkedin.com/in/a-b'], champions: ['https://www.linkedin.com/in/c-d'], notify: false });
    await run('tech-stack', { domain: 'acme.io' });
    const pairs = [...new Set(store.receipts.map((r) => `${r.provider}/${r.tool}`))].sort();
    const missing = pairs.filter((k) => { const [p, t] = k.split('/'); return !registry[p]?.tools[t] || !registry[p]?.pricing.table[t]; });
    expect(missing).toEqual([]);
    expect(pairs.length).toBeGreaterThan(40);
  });
});

describe('USD cap: checked before spending, never overshot', () => {
  it('a waterfall leg that cannot afford every row runs only the rows it can, then stops', async () => {
    const store = new MemoryStore();
    const cap = 0.35;
    const r = await executePlay<BatchOutput>({ store, resolvePlay, play: resolvePlay('name-domain-to-email:batch'), input: { rows: rows(30, (k) => ['eve', 'gil', 'ivy', 'kim'][k % 4]) }, dryRun: true, maxUsd: cap, log: quiet });
    expect(r.status).toBe('aborted');
    expect(r.notes).toMatch(/could not afford every row|would cost up to/);
    expect(r.receipt.totalUsd).toBeLessThanOrEqual(cap);
  });
  it('a single paid call that would not fit is refused before it is made', async () => {
    const store = new MemoryStore();
    const r = await executePlay({ store, resolvePlay, play: resolvePlay('company-signals'), input: { domain: 'acme.io', paid: 'always' }, dryRun: true, maxUsd: 0.15, log: quiet });
    expect(r.status).toBe('aborted');
    expect(r.receipt.totalUsd).toBeLessThanOrEqual(0.15);
  });
  it('prices per_result calls on the page they ask for', () => {
    expect(unitUsd('theirstack', 'company_search', { limit: 10 })).toBeCloseTo(1.0); // 10 × 1 credit × $0.10
    expect(unitUsd('web', 'fetch_page')).toBe(0);
  });
});

describe('probation: a paid leg with no hit on its first rows is demoted for the run', () => {
  it('stops calling a finder that missed its first 5 rows', async () => {
    const store = new MemoryStore();
    const r = await executePlay<BatchOutput>({ store, resolvePlay, play: resolvePlay('name-domain-to-email:batch'), input: { rows: rows(20, () => 'wolf') }, dryRun: true, maxUsd: 100, log: quiet });
    const hunter = r.receipt.legs.find((l) => l.leg === 'hunter')!;
    expect(hunter.calls).toBe(5);
    expect(hunter.label).toBe('DEMOTED');
    expect(r.output!.rows.every((row) => !(row.cells.email as EmailCell | undefined)?.value)).toBe(true);
  });
});

describe('monthly budget from the receipts ledger', () => {
  it('refuses a paid run once the month is spent, before calling anything', async () => {
    const store = new MemoryStore();
    await store.insertReceipt({ provider: 'apollo', tool: 'people_match', inputHash: 'x', input: {}, output: {}, status: 'hit', pricingBasis: 'per_hit', costCredits: 100, costUsd: 10 });
    const r = await executePlay({ store, resolvePlay, play: resolvePlay('score-accounts'), input: {}, dryRun: false, monthlyBudgetUsd: 10, log: quiet });
    expect(r.status).toBe('aborted');
    expect(r.notes).toMatch(/Monthly budget reached/);
  });
});

describe('estimate before running', () => {
  it('prices the dry-run call structure with real list prices, worst case', async () => {
    const e = await estimateRun({ play: resolvePlay('prospect'), input: { countries: ['FR'], seed_domains: ['lemlist.com'], titles: ['VP Sales'], offer: OFFER, accounts: 2, out_dir: fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-')) }, resolvePlay });
    expect(e.worstUsd).toBeGreaterThan(0);
    expect(e.freeCalls).toBeGreaterThan(e.paidCalls);
    expect(e.lines.find((l) => l.provider === 'llm')?.usd).toBeGreaterThan(0);
  });
});

describe('suppression and disqualification happen before any paid call', () => {
  const prev = process.env.GTM_SUPPRESSION_FILE;
  afterEach(() => { if (prev === undefined) delete process.env.GTM_SUPPRESSION_FILE; else process.env.GTM_SUPPRESSION_FILE = prev; });
  it('a suppressed domain costs nothing in the email cascade and is dropped from prospecting', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-')), 'suppression.txt');
    fs.writeFileSync(file, '# customers\nco0.io\nlogicielalpha.fr\n');
    process.env.GTM_SUPPRESSION_FILE = file;
    const store = new MemoryStore();
    const r = await executePlay<BatchOutput>({ store, resolvePlay, play: resolvePlay('name-domain-to-email:batch'), input: { rows: rows(2, () => 'eve') }, dryRun: true, log: quiet });
    const supRow = r.output!.rows.find((x) => x.input.domain === 'co0.io')!;
    expect((supRow.cells.email as EmailCell).missReason).toMatch(/suppressed/);
    expect(store.receipts.filter((x) => (x.input as any).domain === 'co0.io')).toEqual([]);
    const p = await executePlay<ProspectOutput>({ store: new MemoryStore(), resolvePlay, play: resolvePlay('prospect'), input: { countries: ['FR'], titles: ['CEO'], offer: OFFER, accounts: 2, out_dir: fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-')) }, dryRun: true, log: quiet });
    expect(p.output!.excluded.suppressed).toBe(1);
    expect(p.output!.accounts.map((a) => a.domain)).not.toContain('logicielalpha.fr');
  });
  it('drops accounts whose known data is outside the ICP, never on unknowns', () => {
    expect(disqualify({ headcount: 2000 }, { headcount_max: 200 })).toMatch(/above/);
    expect(disqualify({ employeesRange: '1-2' }, { headcount_min: 20 })).toMatch(/below/);
    expect(disqualify({ country: 'Germany' }, { countries: ['FR'] })).toMatch(/outside/);
    expect(disqualify({ country: 'France', headcount: 80 }, { countries: ['FR'], headcount_min: 20, headcount_max: 200 })).toBeNull();
    expect(disqualify({}, { countries: ['FR'], headcount_min: 20 })).toBeNull();
  });
});
