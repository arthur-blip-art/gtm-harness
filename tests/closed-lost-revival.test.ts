import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, revivalAngle, type Output } from '../src/plays/closed-lost-revival.ts';

const quiet = () => {};

describe('closed-lost-revival (HubSpot + signals mock)', () => {
  it('keeps the closed-lost deal, scores signals after the loss, proposes the in-house angle', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input: {}, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    const o = r.output!;
    expect(o.source).toBe('hubspot');
    expect(o.accounts.map((a) => a.domain)).toEqual(['payflow.com']); // the open deal is ignored
    const a = o.accounts[0];
    expect(a).toMatchObject({ lost_reason: 'Built in-house', days_since_loss: 90, recipe: 'revive-closed-lost' });
    expect(a.angle).toMatch(/maintenance des connecteurs/);
    // mock signals: funding 2026-08-15, integration/partnership jobs in September, headcount +12.5 % — all after a loss ~2026-07-15
    expect(a.reasons).toEqual(expect.arrayContaining(['nouvelle levée']));
    expect(a.tier).toBe('chaud');
    expect(r.receipt.totalCredits).toBeGreaterThan(0);
  });
  it('accepts deals[] instead of HubSpot, without pulling signals', async () => {
    const store = new MemoryStore();
    const closedate = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10);
    const r = await executePlay<Output>({ store, resolvePlay, play, input: { pull_signals: false, deals: [{ domain: 'https://www.acme.fr', lost_reason: 'Price', closedate }, { domain: 'old.fr', lost_reason: 'Timing', closedate: '2020-01-01' }] }, dryRun: true, log: quiet });
    expect(r.output!.source).toBe('input');
    expect(r.output!.accounts).toHaveLength(1);
    expect(r.output!.accounts[0]).toMatchObject({ domain: 'acme.fr', score: 0, tier: 'froid' });
    expect(r.output!.accounts[0].angle).toMatch(/nouveau plan/);
    expect(store.receipts).toHaveLength(0);
  });
  it('maps loss reasons to angles', () => {
    expect(revivalAngle('Timing', 'levée Series A')).toMatch(/Timing.*levée Series A/);
    expect(revivalAngle('Went with Codat')).toMatch(/concurrent/);
  });
});
