import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, batch, type Output } from '../src/plays/company-tech.ts';
import type { BatchOutput } from '../src/core/row-play.ts';

const quiet = () => {};

describe('company-tech (mock web.fetch_page + web.dns)', () => {
  it('detects stack from scripts and DNS, writes companies.tech and a monthly tech_stack signal', async () => {
    const store = new MemoryStore();
    await store.upsertCompany({ domain: 'example.com', tech: ['Salesforce'], fieldSources: { tech: 'apollo' }, raw: {} });
    const r = await executePlay<Output>({ store, resolvePlay, play, input: { domain: 'https://www.example.com/' }, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    expect(r.output!.tech).toEqual(['Google Workspace', 'HubSpot', 'Pennylane', 'Segment', 'Zendesk']); // Pennylane: listed on the mock /integrations page
    expect(r.output!.competitors).toEqual([]);
    const co = (await store.listCompanies(['example.com']))[0];
    expect(co.tech).toEqual(['Google Workspace', 'HubSpot', 'Pennylane', 'Salesforce', 'Segment', 'Zendesk']);
    expect(co.fieldSources.tech).toBe('company-tech');
    expect([...store.signals.values()].map((s) => s.type)).toEqual(['tech_stack']);

    const r2 = await executePlay<Output>({ store, resolvePlay, play, input: { domain: 'example.com' }, dryRun: true, log: quiet });
    expect(r2.output!.inserted).toBe(0); // same month → same dedupe key
  });
  it('flags a competitor "powered by" on the integrations page', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input: { domain: 'codatuser.com' }, dryRun: true, log: quiet });
    expect(r.output!.competitors).toEqual(['Codat']);
    expect(r.output!.tech).toContain('Pennylane');
    const sig = [...store.signals.values()].find((s) => s.type === 'competitor_detected')!;
    expect(sig).toMatchObject({ domain: 'codatuser.com', value: { competitor: 'Codat', url: 'https://codatuser.com/integrations' } });
  });
  it('batch variant runs per domain row', async () => {
    const store = new MemoryStore();
    const r = await executePlay<BatchOutput>({ store, resolvePlay, play: batch, input: { rows: [{ domain: 'example.com' }, { domain: 'codatuser.com' }, { name: 'no domain' }] }, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    expect(r.output!.rows).toHaveLength(3);
    expect(store.companies.size).toBe(2);
  });
});
