import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, type Output } from '../src/plays/competitor-customers.ts';

const quiet = () => {};
const input = { competitors: [{ name: 'Codat', domain: 'codat.io', customer_pages: ['https://www.codat.io/customers'] }], exclude_domains: ['retailco.fr'] };

describe('competitor-customers (mock)', () => {
  it('collects candidates with confidence, filters noise, writes companies + signals, idempotent on rerun', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    const by = Object.fromEntries(r.output!.candidates.map((c) => [c.domain, c.confidence]));
    // customer page links: billwise + payflow high; retailco excluded; codat.io/blog is the competitor itself
    expect(by['billwise.io']).toBe('high');
    expect(by['payflow.com']).toBe('high');
    expect(by['retailco.fr']).toBeUndefined();
    expect(by['codat.io']).toBeUndefined();
    expect(by['poweredbycodat.com']).toBe('medium'); // mock serper turns the query into a domain
    expect(by['codatcasestudy.com']).toBe('low');
    expect(r.output!.new_candidates).toBe(r.output!.candidates.length);
    expect(r.output!.notified).toBe('skipped');
    expect(store.companies.get('billwise.io')?.raw.competitor_customer_of).toEqual(['Codat']);
    expect([...store.signals.values()].every((s) => s.type === 'competitor_customer')).toBe(true);

    const r2 = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r2.output!.new_candidates).toBe(0);
    expect(r2.output!.notified).toBe('none');
  });
  it('enriches and scores the non-low new candidates when asked', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input: { ...input, enrich: true }, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    expect(r.output!.enriched).toBe(r.output!.candidates.filter((c) => c.confidence !== 'low').length);
  });
  it('the Chift config parses', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'config', 'competitor-customers.chift.json'), 'utf8'));
    expect(play.input.parse(cfg).competitors.length).toBeGreaterThanOrEqual(4);
  });
});
