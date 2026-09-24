import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import type { Output as PipelineOutput } from '../src/plays/icp-to-pipeline.ts';
import type { Output as IcpOutput } from '../src/plays/icp-to-companies.ts';
import type { Output as SignalsOutput } from '../src/plays/company-signals.ts';
import type { Output as ScoreOutput } from '../src/plays/score-accounts.ts';
import type { Output as SyncOutput } from '../src/plays/sync-hubspot.ts';
import type { CompanyProfile } from '../src/plays/company-enrich.ts';

const quiet = () => {};

describe('company plays', () => {
  it('icp-to-companies sizes with limit:1 then buys and dedupes', async () => {
    const store = new MemoryStore();
    const r = await executePlay<IcpOutput>({ store, resolvePlay, play: resolvePlay('icp-to-companies'), input: { countries: ['FR'], limit: 4 }, dryRun: true, log: quiet });
    expect(r.output!.counts).toEqual({ apollo: 42, theirstack: 17, crustdata: 9 });
    expect(r.output!.companies).toHaveLength(4);
    expect(r.output!.bought.apollo).toBe(3);
    expect(store.companies.size).toBe(4);
    const sizeLegs = r.receipt.legs.filter((l) => l.leg.endsWith('_size'));
    expect(sizeLegs).toHaveLength(3);
  });
  it('company-enrich merges by precedence and names sources', async () => {
    const store = new MemoryStore();
    const r = await executePlay<CompanyProfile>({ store, resolvePlay, play: resolvePlay('company-enrich'), input: { domain: 'https://www.chift.eu/' }, dryRun: true, log: quiet });
    expect(r.output).toMatchObject({ domain: 'chift.eu', headcount: 120, fieldSources: { headcount: 'apollo', name: 'apollo' }, sources: { apollo: 'hit', pdl: 'hit', crustdata: 'hit' } });
    expect(store.companies.get('chift.eu')?.headcount).toBe(120);
  });
  it('company-signals is idempotent and score-accounts grades the population', async () => {
    const store = new MemoryStore();
    await executePlay<CompanyProfile>({ store, resolvePlay, play: resolvePlay('company-enrich'), input: { domain: 'chift.eu' }, dryRun: true, log: quiet });
    await executePlay<CompanyProfile>({ store, resolvePlay, play: resolvePlay('company-enrich'), input: { domain: 'other.io' }, dryRun: true, log: quiet });
    const s1 = await executePlay<SignalsOutput>({ store, resolvePlay, play: resolvePlay('company-signals'), input: { domain: 'chift.eu' }, dryRun: true, log: quiet });
    expect(s1.output!.inserted).toBe(5); // 1 funding + 2 predictleads jobs + 1 theirstack job + 1 headcount growth
    const s2 = await executePlay<SignalsOutput>({ store, resolvePlay, play: resolvePlay('company-signals'), input: { domain: 'chift.eu' }, dryRun: true, log: quiet });
    expect(s2.output!.inserted).toBe(0);
    expect(s2.newReceipts).toBe(0);
    const sc = await executePlay<ScoreOutput>({ store, resolvePlay, play: resolvePlay('score-accounts'), input: {}, dryRun: true, log: quiet });
    const fit = sc.output!.scores.filter((s) => s.dimension === 'account_fit');
    expect(fit).toHaveLength(2);
    expect(fit.every((s) => s.score !== null)).toBe(true);
    const eng = sc.output!.scores.find((s) => s.dimension === 'account_engagement' && s.domain === 'chift.eu')!;
    expect(eng.score).toBeGreaterThan(0);
    expect(eng.reasons.map((r: any) => r.feature)).toContain('funding_recent');
    expect(sc.receipt.totalCredits).toBe(0);
  });
});

describe('sync-hubspot', () => {
  it('sends only HIGH/MEDIUM emails, stores ids, and skips unchanged records on rerun', async () => {
    const store = new MemoryStore();
    await store.upsertCompany({ domain: 'chift.eu', name: 'Chift', fieldSources: {}, raw: {} });
    await store.upsertPerson({ personKey: 'p1', firstName: 'Alice', lastName: 'Dupont', domain: 'chift.eu', email: 'alice@chift.eu', emailStatus: 'valid', emailSource: 'apollo', confidence: 'HIGH', fieldSources: {}, raw: {} });
    await store.upsertPerson({ personKey: 'p2', firstName: 'Bob', lastName: 'Hold', domain: 'chift.eu', email: 'bob@chift.eu', emailStatus: 'unknown', emailSource: 'pdl', confidence: 'HOLD', fieldSources: {}, raw: {} });
    const r1 = await executePlay<SyncOutput>({ store, resolvePlay, play: resolvePlay('sync-hubspot'), input: {}, dryRun: true, log: quiet });
    expect(r1.output).toMatchObject({ created: 2, updated: 0, skipped: 0, excluded: 1, errors: [] });
    expect((await store.getCrmSync('person', 'p1', 'hubspot'))?.crmId).toMatch(/^hs_/);
    const r2 = await executePlay<SyncOutput>({ store, resolvePlay, play: resolvePlay('sync-hubspot'), input: {}, dryRun: true, log: quiet });
    expect(r2.output).toMatchObject({ created: 0, updated: 0, skipped: 2 });
    await store.upsertPerson({ personKey: 'p1', title: 'CTO', email: 'alice@chift.eu', emailStatus: 'valid', emailSource: 'apollo', confidence: 'HIGH', fieldSources: {}, raw: {} });
    const r3 = await executePlay<SyncOutput>({ store, resolvePlay, play: resolvePlay('sync-hubspot'), input: {}, dryRun: true, log: quiet });
    expect(r3.output).toMatchObject({ created: 0, updated: 1, skipped: 1 });
  });
});

describe('icp-to-pipeline (composition)', () => {
  it('runs children under one run id with one receipt whose credits equal the sum', async () => {
    const store = new MemoryStore();
    const r = await executePlay<PipelineOutput>({ store, resolvePlay, play: resolvePlay('icp-to-pipeline'), input: { countries: ['FR'], limit: 2, titles: ['CTO', 'VP Product'], people_per_company: 2, sync: true }, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    expect(r.output).toMatchObject({ companies: 2, people: 4 });
    expect(r.output!.emails.high + r.output!.emails.medium + r.output!.emails.hold + r.output!.emails.none).toBe(4);
    expect(r.output!.sync?.created).toBeGreaterThan(0);
    const receipts = store.receipts.filter((x) => x.runId === r.runId);
    expect(receipts.length).toBeGreaterThan(5);
    expect(r.receipt.totalCredits).toBeCloseTo(receipts.filter((x) => !x.cached).reduce((a, x) => a + x.costCredits, 0), 5);
    const legs = r.receipt.legs.map((l) => l.leg);
    expect(legs).toEqual(expect.arrayContaining(['apollo_size', 'apollo', 'pattern', 'hubspot_upsert']));
  });
});
