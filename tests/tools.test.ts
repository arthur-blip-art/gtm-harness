import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { ToolRunner } from '../src/core/tools.ts';
import { registry } from '../src/providers/index.ts';
import { defineAdapter, costFromTable } from '../src/providers/_adapter.ts';

describe('ToolRunner cache + receipts', () => {
  it('serves the second identical call from cache at zero cost', async () => {
    const store = new MemoryStore();
    const runner = new ToolRunner(store, registry, { dryRun: true });
    const a = await runner.execute({ provider: 'apollo', tool: 'people_match', input: { first_name: 'Ida', last_name: 'Moreau', domain: 'x.com' }, runId: 'r1' });
    const b = await runner.execute({ provider: 'apollo', tool: 'people_match', input: { last_name: ' MOREAU', first_name: 'ida ', domain: 'x.com' }, runId: 'r2' });
    expect(a.status).toBe('hit');
    expect(a.costCredits).toBe(1);
    expect(b.cached).toBe(true);
    expect(b.id).toBe(a.id);
    expect(store.receipts).toHaveLength(1);
  });
  it('refresh bypasses the cache', async () => {
    const store = new MemoryStore();
    const runner = new ToolRunner(store, registry, { dryRun: true, refresh: true });
    await runner.execute({ provider: 'apollo', tool: 'people_match', input: { first_name: 'Ida', last_name: 'Klein', domain: 'x.com' } });
    await runner.execute({ provider: 'apollo', tool: 'people_match', input: { first_name: 'Ida', last_name: 'Klein', domain: 'x.com' } });
    expect(store.receipts).toHaveLength(2);
  });
  it('never serves errors from cache and charges nothing for them', async () => {
    const store = new MemoryStore();
    let calls = 0;
    const flaky = defineAdapter({
      name: 'flaky', requiredEnv: [], pricing: { usdPerCredit: 0.1, verifiedOn: 'x', table: { t: { basis: 'per_call', credits: 2 } } },
      tools: { t: { description: 't', normalize: (i) => i, async execute() { calls++; return calls === 1 ? { status: 'error', error: 'boom' } : { status: 'miss', missReason: 'nope' }; }, cost: costFromTable({ basis: 'per_call', credits: 2 }) } },
    });
    const runner = new ToolRunner(store, { flaky }, {});
    const a = await runner.execute({ provider: 'flaky', tool: 't', input: { q: 1 } });
    const b = await runner.execute({ provider: 'flaky', tool: 't', input: { q: 1 } });
    expect(a.status).toBe('error');
    expect(a.costCredits).toBe(0);
    expect(b.status).toBe('miss');
    expect(b.cached).toBeUndefined();
    expect(b.costCredits).toBe(2);
  });
  it('batch: only uncached items reach the provider', async () => {
    const store = new MemoryStore();
    const runner = new ToolRunner(store, registry, { dryRun: true });
    const inputs = [{ first_name: 'A', last_name: 'Rey', domain: 'x.com' }, { first_name: 'B', last_name: 'Solo', domain: 'x.com' }];
    await runner.executeBatch({ provider: 'fullenrich', tool: 'bulk_enrich', inputs: [inputs[0]] });
    const rs = await runner.executeBatch({ provider: 'fullenrich', tool: 'bulk_enrich', inputs });
    expect(rs[0].cached).toBe(true);
    expect(rs[1].cached).toBeUndefined();
    expect(store.receipts).toHaveLength(2);
  });
});
