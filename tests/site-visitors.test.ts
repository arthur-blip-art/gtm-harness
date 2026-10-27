import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { DEFAULT_PAGE_WEIGHTS, intentScore, isoWeek, play, type Output } from '../src/plays/site-visitors.ts';

const quiet = () => {};
const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'config', 'site-visitors.example.json'), 'utf8'));
const run = (store: MemoryStore, input: Record<string, unknown>) => executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });

describe('site-visitors (mock)', () => {
  it('scores intent, drops ISPs, enriches the hot account, and is silent on rerun the same week', async () => {
    const store = new MemoryStore();
    const r1 = await run(store, config);
    expect(r1.status).toBe('done');
    const o = r1.output!;
    expect(o.excluded).toEqual([{ domain: 'orange.fr', reason: 'isp_or_host' }]);
    const billwise = o.accounts.find((a) => a.domain === 'billwise.io')!;
    expect(billwise).toMatchObject({ qualified: true, fit_tier: 'A', new: true });
    expect(billwise.intent_score).toBe(22); // (3+3+2+3) × log2(4)
    expect(o.accounts.find((a) => a.domain === 'payflow.com')).toMatchObject({ qualified: false, intent_score: 1.5, fit_tier: null });
    expect(o.qualified).toBe(1);
    expect(o.notified).toBe('skipped');
    expect([...store.signals.values()].filter((s) => s.type === 'site_visit')).toHaveLength(1);

    const r2 = await run(store, config);
    expect(r2.output!.new_signals).toBe(0);
    expect(r2.output!.notified).toBe('none');
  });

  it('flags a customer on /pricing as expansion instead of dropping it; drops competitors', async () => {
    const store = new MemoryStore();
    const r = await run(store, { visits: [
      { domain: 'acme-customer.com', pages: ['/pricing', '/integrations'] },
      { domain: 'codat.io', pages: ['/pricing'] },
    ], enrich: false });
    expect(r.output!.accounts[0]).toMatchObject({ domain: 'acme-customer.com', flag: 'customer_expansion', qualified: true });
    expect(r.output!.excluded).toEqual([{ domain: 'codat.io', reason: 'competitor' }]);
  });

  it('helpers', () => {
    expect(isoWeek(new Date('2026-10-13T10:00:00Z'))).toBe('2026-W42');
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
    expect(intentScore(['/blog/x', '/blog/x', '/about'], 1, DEFAULT_PAGE_WEIGHTS, 1)).toBe(1.5);
  });
});
