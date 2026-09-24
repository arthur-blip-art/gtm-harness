import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { MemoryStore } from '../src/store/memory.ts';
import { loadCsv, legSummary } from '../src/core/dataset.ts';
import * as play from '../src/plays/name-domain-to-email.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { executePlay } from '../src/core/run.ts';
import { buildReceipt } from '../src/core/receipt.ts';
import type { BatchOutput } from '../src/core/row-play.ts';
import type { EmailCell, LegCell } from '../src/core/types.ts';

const fixture = path.join(import.meta.dirname, 'fixtures', '3rows.csv');
const quiet = () => {};

describe('name-domain-to-email on the mock provider', () => {
  it('maps French headers, resolves a missing domain, runs the legs in order and stops on acceptance', async () => {
    const csv = loadCsv(fixture);
    expect(csv.columns).toMatchObject({ first_name: 'Prénom', last_name: 'Nom', domain: 'Website', company: 'Company' });
    const store = new MemoryStore();
    const res = await executePlay<BatchOutput>({ store, resolvePlay, play: play.batch, input: { rows: csv.rows, slug: 't' }, dryRun: true, log: quiet });
    const rows = res.output!.rows;

    // Alice Dupont: d → leg 1 (pattern); later legs never called for her.
    expect(rows[0].cells.email as EmailCell).toMatchObject({ value: 'alice.dupont@chift.eu', source: 'pattern', confidence: 'HIGH' });
    expect((rows[0].cells.email_result__apollo as LegCell).status).toBe('not_reached');
    // Bob Martin: m → apollo, after hunter/leadmagic/findymail/prospeo missed.
    expect(rows[1].cells.email as EmailCell).toMatchObject({ value: 'bob.martin@pennylane.com', source: 'apollo' });
    expect((rows[1].cells.email_result__hunter as LegCell).status).toBe('miss');
    // Chloé Xavier: domain resolved from company via search, then x → miss everywhere.
    expect(rows[2].input.domain).toBe('qonto.com');
    expect(rows[2].cells.email as EmailCell).toMatchObject({ value: null, missReason: 'no_match_all_legs' });
    expect(legSummary(rows[2].cells.email_result__pdl as LegCell)).toBe('miss:no_match');

    const byLeg = Object.fromEntries(res.receipt.legs.map((l) => [l.leg, l]));
    expect(byLeg.resolve_domain).toMatchObject({ rowsReached: 1, accepted: 1 });
    expect(byLeg.pattern.rowsReached).toBe(3);
    expect(byLeg.apollo.rowsReached).toBe(2);
    expect(byLeg.fullenrich.rowsReached).toBe(1);
    expect(byLeg.crustdata.label).toBe('NEVER REACHED'); // no linkedin_url in the CSV → skipped rows are not "reached"
    expect(byLeg.apollo.label).toBe('');
    expect(byLeg.verify.rowsReached).toBe(0);
    expect(res.receipt.totalCredits).toBeCloseTo(0.01 + 0.03 + 0.03 + 1 + 0.05, 5);
    expect(res.status).toBe('done');
  });

  it('a rerun over the same rows costs nothing and skips HIGH rows', async () => {
    const csv = loadCsv(fixture);
    const store = new MemoryStore();
    await executePlay<BatchOutput>({ store, resolvePlay, play: play.batch, input: { rows: csv.rows, slug: 't' }, dryRun: true, log: quiet });
    const r2 = await executePlay<BatchOutput>({ store, resolvePlay, play: play.batch, input: { rows: csv.rows, slug: 't' }, dryRun: true, log: quiet });
    expect(r2.receipt.totalCredits).toBe(0);
    expect(r2.newReceipts).toBe(0);
    expect(store.receipts.filter((r) => r.runId === r2.runId)).toHaveLength(0);
    expect(r2.output!.rows[0].cells.email as EmailCell).toMatchObject({ value: 'alice.dupont@chift.eu', confidence: 'HIGH' });
    const byLeg = Object.fromEntries(r2.receipt.legs.map((l) => [l.leg, l]));
    expect(byLeg.pattern.rowsReached).toBe(1); // only Chloé is still pending
  });

  it('promotes a PDL unknown to HIGH through the verifier, and corroborates a catch-all with ZeroBounce', async () => {
    const store = new MemoryStore();
    const rows = [
      { first_name: 'Sam', last_name: 'Roux', domain: 'a.com' },     // r → pdl unknown → verify ok → HIGH
      { first_name: 'Paul', last_name: 'Petit', domain: 'b.com' },   // p → fullenrich CATCH_ALL → verify catch_all → zerobounce catch-all → MEDIUM
    ];
    const res = await executePlay<BatchOutput>({ store, resolvePlay, play: play.batch, input: { rows, slug: 'v' }, dryRun: true, log: quiet });
    const [sam, paul] = res.output!.rows;
    expect(sam.cells.email as EmailCell).toMatchObject({ value: 'sam.roux@a.com', confidence: 'HIGH', source: 'pdl+verify' });
    expect(paul.cells.email as EmailCell).toMatchObject({ value: 'paul.petit@b.com', confidence: 'MEDIUM', status: 'catch_all' });
    const byLeg = Object.fromEntries(res.receipt.legs.map((l) => [l.leg, l]));
    expect(byLeg.verify.rowsReached).toBe(2);
    expect(byLeg.zerobounce.rowsReached).toBe(1);
  });

  it('flags a leg that spent and accepted nothing, and aborts on the credit cap', async () => {
    const r = buildReceipt('x', 2, [
      { id: '1', provider: 'peopledatalabs', tool: 'person_enrich', inputHash: 'h', input: {}, output: {}, status: 'hit', pricingBasis: 'per_hit', costCredits: 3, costUsd: 0.3, createdAt: '', runId: 'x' },
    ], [{ leg: 'pdl', provider: 'peopledatalabs', tool: 'person_enrich', rowsReached: 1, accepted: 0, receiptIds: ['1'] }]);
    expect(r.legs[0].label).toBe('CUT CANDIDATE');

    const csv = loadCsv(fixture);
    const store = new MemoryStore();
    const res = await executePlay<BatchOutput>({ store, resolvePlay, play: play.batch, input: { rows: csv.rows, slug: 'cap' }, dryRun: true, maxCredits: 0.5, log: quiet });
    expect(res.status).toBe('aborted');
    expect(res.notes).toMatch(/Budget exceeded/);
  });

  it('scalar variant returns the cell and shares the cache with batch', async () => {
    const store = new MemoryStore();
    const cell = await executePlay<EmailCell>({ store, resolvePlay, play: play.scalar, input: { first_name: 'Alice', last_name: 'Dupont', domain: 'chift.eu' }, dryRun: true, log: quiet });
    expect(cell.output).toMatchObject({ value: 'alice.dupont@chift.eu', confidence: 'HIGH' });
    const again = await executePlay<EmailCell>({ store, resolvePlay, play: play.scalar, input: { first_name: 'alice', last_name: 'DUPONT', domain: 'www.chift.eu' }, dryRun: true, log: quiet });
    expect(again.newReceipts).toBe(0);
  });
});
