import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, assessDeal, type Output } from '../src/plays/deal-health.ts';

const quiet = () => {};

describe('deal-health (HubSpot mock)', () => {
  it('flags the stale open deal without next step as critical and skips the closed one', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input: {}, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    const o = r.output!;
    expect(o.deals.map((d) => d.id)).toEqual(['hs_deal_1']);
    expect(o.deals[0]).toMatchObject({ health: 'critique', days_since_activity: 40 });
    expect(o.deals[0].problems).toEqual(expect.arrayContaining(['pas de next step', 'close date absente', 'aucune activité depuis 40 j']));
    expect(o.counts.critique).toBe(1);
    expect(o.notified).toBe('skipped');
    expect(o.written).toBe(0);
    expect(store.receipts.some((x) => x.tool === 'update')).toBe(false);
    const r2 = await executePlay<Output>({ store, resolvePlay, play, input: {}, dryRun: true, log: quiet });
    expect(r2.output!.notified).toBe('none'); // already alerted this week
  });
  it('write: true updates the deal properties', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input: { write: true, notify: false }, dryRun: true, log: quiet });
    expect(r.output!.written).toBe(1);
  });
  it('scores a healthy and an old deal', () => {
    const now = Date.parse('2026-10-13T00:00:00Z');
    const day = (n: number) => new Date(now - n * 86400000).toISOString();
    expect(assessDeal('a', { hs_next_step: 'demo', closedate: day(-20), notes_last_updated: day(3), createdate: day(30) }, { stale_days: 21, max_age_days: 120 }, now).health).toBe('sain');
    const old = assessDeal('b', { hs_next_step: 'demo', closedate: day(-20), notes_last_updated: day(3), createdate: day(200) }, { stale_days: 21, max_age_days: 120 }, now);
    expect(old).toMatchObject({ health: 'à surveiller', problems: ['deal ouvert depuis 200 j'] });
  });
});
