import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { MemoryStore } from '../src/store/memory.ts';
import { ToolRunner } from '../src/core/tools.ts';
import { registry } from '../src/providers/index.ts';
import { loadCsv, toRowStates, legSummary } from '../src/core/dataset.ts';
import * as play from '../src/plays/name-domain-to-email.ts';
import { buildReceipt } from '../src/core/receipt.ts';
import type { EmailCell, LegCell } from '../src/core/types.ts';

const fixture = path.join(import.meta.dirname, 'fixtures', '3rows.csv');

describe('name-domain-to-email on the mock provider', () => {
  it('maps French headers, resolves a missing domain, runs the legs in order and stops on acceptance', async () => {
    const csv = loadCsv(fixture);
    expect(csv.columns).toMatchObject({ first_name: 'Prénom', last_name: 'Nom', domain: 'Website', company: 'Company' });
    const rows = toRowStates(csv.rows, new Map());
    const store = new MemoryStore();
    const runner = new ToolRunner(store, registry, { dryRun: true });
    const metas = await play.run(rows, runner, { runId: 'r', dryRun: true, log: () => {} });

    // Alice Dupont: last name d → found by leg 1 (pattern); later legs never called for her.
    const alice = rows[0];
    expect((alice.cells.email as EmailCell)).toMatchObject({ value: 'alice.dupont@chift.eu', source: 'pattern', confidence: 'HIGH' });
    expect((alice.cells.email_result__apollo as LegCell).status).toBe('not_reached');

    // Bob Martin: m → apollo leg.
    const bob = rows[1];
    expect((bob.cells.email as EmailCell)).toMatchObject({ value: 'bob.martin@pennylane.com', source: 'apollo' });
    expect((bob.cells.email_result__pattern as LegCell).status).toBe('miss');

    // Chloé Xavier: domain resolved from company via search, then x → miss everywhere.
    const chloe = rows[2];
    expect(chloe.input.domain).toBe('qonto.com');
    expect((chloe.cells.email as EmailCell)).toMatchObject({ value: null, missReason: 'no_match_all_legs' });
    expect(legSummary(chloe.cells.email_result__pdl as LegCell)).toBe('miss:no_match');

    const receipt = buildReceipt('r', rows.length, await store.listReceiptsByRun('r'), metas);
    const byLeg = Object.fromEntries(receipt.legs.map((l) => [l.leg, l]));
    expect(byLeg.pattern.rowsReached).toBe(3);
    expect(byLeg.apollo.rowsReached).toBe(2);
    expect(byLeg.fullenrich.rowsReached).toBe(1);
    expect(byLeg.crustdata.rowsReached).toBe(0); // no linkedin_url in the CSV
    expect(byLeg.pdl.label).toBe(''); // reached 1 row but per_hit miss costs 0, so not a cut candidate
    expect(byLeg.apollo.label).toBe(''); // spent 1 credit and accepted 1: a working leg, never cut
    expect(byLeg.resolve_domain).toMatchObject({ rowsReached: 1, accepted: 1 });
    expect(byLeg.crustdata.label).toBe('NEVER REACHED');
    expect(receipt.totalCredits).toBeCloseTo(1.08, 5); // 3×0.01 + 1 + 0.05 search
  });

  it('flags a leg that spent and accepted nothing, and aborts on the credit cap', async () => {
    const { buildReceipt: br } = await import('../src/core/receipt.ts');
    const r = br('x', 2, [
      { id: '1', provider: 'peopledatalabs', tool: 'person_enrich', inputHash: 'h', input: {}, output: {}, status: 'hit', pricingBasis: 'per_hit', costCredits: 3, costUsd: 0.3, createdAt: '', runId: 'x' },
    ], [{ leg: 'pdl', provider: 'peopledatalabs', tool: 'person_enrich', rowsReached: 1, accepted: 0 }]);
    expect(r.legs[0].label).toBe('CUT CANDIDATE');

    const csv = loadCsv(fixture);
    const rows = toRowStates(csv.rows, new Map());
    const store = new MemoryStore();
    const runner = new ToolRunner(store, registry, { dryRun: true });
    await expect(play.run(rows, runner, { runId: 'cap', dryRun: true, log: () => {}, maxCredits: 0.5 })).rejects.toThrow(/Budget exceeded/);
    expect((rows[2].cells.email_result__fullenrich as LegCell).status).toBe('not_reached');
    expect((rows[0].cells.email as EmailCell).value).toBe('alice.dupont@chift.eu');
  });

  it('a rerun over the same rows costs nothing', async () => {
    const csv = loadCsv(fixture);
    const store = new MemoryStore();
    const runner = new ToolRunner(store, registry, { dryRun: true });
    await play.run(toRowStates(csv.rows, new Map()), runner, { runId: 'r1', dryRun: true, log: () => {} });
    const rows2 = toRowStates(csv.rows, new Map());
    const metas2 = await play.run(rows2, runner, { runId: 'r2', dryRun: true, log: () => {} });
    const r2 = buildReceipt('r2', rows2.length, await store.listReceiptsByRun('r2'), metas2);
    expect(r2.totalCredits).toBe(0);
    expect(store.receipts.filter((r) => r.runId === 'r2')).toHaveLength(0);
  });
});
