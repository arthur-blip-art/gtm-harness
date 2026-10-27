import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { createCtx } from '../src/core/play.ts';
import { ToolRunner } from '../src/core/tools.ts';
import { registry } from '../src/providers/index.ts';
import { recordTouches, type SuppressResult } from '../src/plays/suppress.ts';

const quiet = () => {};

describe('suppress', () => {
  it('drops customers, partners, open deals, opt-outs and recent contacts; keeps the rest', async () => {
    const store = new MemoryStore();
    const people = [
      { email: 'a@acme-customer.com', domain: 'acme-customer.com' },
      { email: 'b@beta-partner.io', domain: 'beta-partner.io' },
      { email: 'c@known-deal.com', domain: 'known-deal.com' },
      { email: 'optout@fresh.io', domain: 'fresh.io' },
      { email: 'recent@fresh.io', domain: 'fresh.io' },
      { email: 'new@fresh.io', domain: 'fresh.io' },
      { first_name: 'nobody' },
    ];
    const r = await executePlay<SuppressResult>({ store, resolvePlay, play: resolvePlay('suppress'), input: { people }, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    expect(r.output!.kept.map((p) => p.email)).toEqual(['new@fresh.io']);
    expect(Object.fromEntries(r.output!.dropped.map((d) => [d.email ?? 'none', d.suppress_reason]))).toEqual({
      'a@acme-customer.com': 'customer', 'b@beta-partner.io': 'partner', 'c@known-deal.com': 'open_deal',
      'optout@fresh.io': 'opted_out', 'recent@fresh.io': 'recently_contacted', none: 'no_identity',
    });
  });
  it('a touch recorded by the harness suppresses the next run within the cooldown', async () => {
    const store = new MemoryStore();
    const runner = new ToolRunner(store, registry, { dryRun: true });
    const ctx = createCtx({ runId: 'r', playName: 't', runner, store, dryRun: true, resolvePlay });
    expect(await recordTouches([{ email: 'new@fresh.io' }], ctx, { channel: 'instantly', campaign: 'q4-pennylane' })).toBe(1);
    const r = await executePlay<SuppressResult>({ store, resolvePlay, play: resolvePlay('suppress'), input: { people: [{ email: 'new@fresh.io' }] }, dryRun: true, log: quiet });
    expect(r.output!.dropped[0]).toMatchObject({ suppress_reason: 'recently_touched' });
    const r2 = await executePlay<SuppressResult>({ store, resolvePlay, play: resolvePlay('suppress'), input: { people: [{ email: 'new@fresh.io' }], cooldown_days: 0 }, dryRun: true, log: quiet });
    expect(r2.output!.kept).toHaveLength(1);
  });
});
