import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, assessCampaign, type Output } from '../src/plays/campaign-report.ts';

const quiet = () => {};

describe('campaign-report (Instantly mock)', () => {
  it('computes rates, verdicts and winners; weekly signal is idempotent', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input: { campaign_ids: ['camp_a', 'camp_b'] }, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    const [a, b] = r.output!.campaigns;
    expect(a).toMatchObject({ id: 'camp_a', sent: 200, reply_rate: 0.07, opportunity_rate: 0.02, bounce_rate: 0.02, verdicts: [] });
    expect(a.winners).toEqual([{ step: 1, variant: 'A', opportunity_rate: 0.03, reply_rate: 0.09, over: ['B'] }]); // step 2 has one variant: no verdict
    expect(b.verdicts).toEqual(['liste à revérifier']); // 18/200 = 9 % bounce
    expect(r.output!.new_signals).toBe(2);
    expect(r.output!.notified).toBe('skipped');
    expect([...store.signals.values()].every((s) => s.type === 'campaign_stats')).toBe(true);
    const r2 = await executePlay<Output>({ store, resolvePlay, play, input: { campaign_ids: ['camp_a', 'camp_b'] }, dryRun: true, log: quiet });
    expect(r2.output!).toMatchObject({ new_signals: 0, notified: 'none' });
    expect(store.signals.size).toBe(2);
  });
  it('low replies on enough volume → angle to rework; under min_sent → no verdict', () => {
    const low = assessCampaign({ id: 'x', name: 'x', sent: 300, replied: 2, opportunities: 0, bounced: 3 }, [], 50);
    expect(low.verdicts).toEqual(['angle ou ciblage à revoir']);
    const small = assessCampaign({ id: 'y', name: 'y', sent: 20, replied: 0, opportunities: 0, bounced: 5 }, [{ step: 0, variant: 'A', sent: 10, replied: 1, opportunities: 1 }, { step: 0, variant: 'B', sent: 10, replied: 0, opportunities: 0 }], 50);
    expect(small.verdicts[0]).toMatch(/pas assez d'envois/);
    expect(small.winners).toEqual([]);
  });
});
