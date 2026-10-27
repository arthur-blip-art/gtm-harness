import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, companyKey, type Output } from '../src/plays/people-moves.ts';

const quiet = () => {};
const run = (store: MemoryStore, input: unknown) => executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });

describe('people-moves (mock: every profile now works at TrackedCo)', () => {
  it('normalizes company names', () => {
    expect(companyKey('TrackedCo SAS')).toBe('trackedco');
    expect(companyKey('Société Générale S.A.')).toBe('societegenerale');
    expect(companyKey('Billwise GmbH')).toBe(companyKey('billwise'));
  });
  it('first sighting is a silent baseline, then a move is detected when the known company differs', async () => {
    const store = new MemoryStore();
    const r1 = await run(store, { people: [{ name: 'Léa Martin', linkedin_url: 'https://linkedin.com/in/lea-martin/' }] });
    expect(r1.status).toBe('done');
    expect(r1.output).toMatchObject({ checked: 1, baselines: 1, moves: [], new_moves: 0, notified: 'none' });
    expect([...store.signals.values()].map((s) => s.type)).toEqual(['person_employer']);

    // same person, still at TrackedCo per the stored baseline → unchanged
    const r2 = await run(store, { people: [{ linkedin_url: 'https://www.linkedin.com/in/lea-martin' }] });
    expect(r2.output).toMatchObject({ baselines: 0, unchanged: 1, new_moves: 0 });

    // the CRM says she is a customer contact at OldCo → move to TrackedCo, signal on the new domain
    const input = { people: [{ name: 'Léa Martin', linkedin_url: 'https://www.linkedin.com/in/lea-martin', company: 'OldCo SAS', domain: 'oldco.fr', relation: 'customer' }] };
    const r3 = await run(store, input);
    expect(r3.output!.moves).toEqual([expect.objectContaining({ from_company: 'OldCo SAS', to_company: 'TrackedCo', to_domain: 'trackedco.com', new_title: 'CTO', relation: 'customer' })]);
    expect(r3.output!.new_moves).toBe(1);
    expect(r3.output!.notified).toBe('skipped'); // dry-run never posts
    const job = [...store.signals.values()].find((s) => s.type === 'job_change')!;
    expect(job).toMatchObject({ domain: 'trackedco.com', value: { from_company: 'OldCo SAS', to_company: 'TrackedCo', relation: 'customer' } });

    // rerun: same move, nothing new, no alert
    const r4 = await run(store, input);
    expect(r4.output).toMatchObject({ new_moves: 0, notified: 'none' });
    expect([...store.signals.values()].filter((s) => s.type === 'job_change')).toHaveLength(1);
  });
  it('reads people from the store and treats a domain match as unchanged', async () => {
    const store = new MemoryStore();
    await store.upsertPerson({ personKey: 'p1', firstName: 'Sam', lastName: 'Diaz', domain: 'trackedco.com', linkedinUrl: 'https://www.linkedin.com/in/sam-diaz', email: null, emailStatus: null, emailSource: null, confidence: 'LOW', fieldSources: {}, raw: {} });
    await store.upsertPerson({ personKey: 'p2', firstName: 'Ana', lastName: 'Ruiz', domain: 'billwise.io', linkedinUrl: 'https://www.linkedin.com/in/ana-ruiz', email: null, emailStatus: null, emailSource: null, confidence: 'LOW', fieldSources: {}, raw: { relation: 'champion' } });
    const r = await run(store, { from_store: true });
    expect(r.output).toMatchObject({ checked: 2, unchanged: 1, new_moves: 1 });
    expect(r.output!.moves[0]).toMatchObject({ person: 'Ana Ruiz', from_domain: 'billwise.io', to_domain: 'trackedco.com', relation: 'champion' });
  });
});
