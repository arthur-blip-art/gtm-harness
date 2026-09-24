import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import type { EmailCell, LinkedinCell, PhoneCell } from '../src/core/types.ts';

const quiet = () => {};

describe('person-to-linkedin', () => {
  it('accepts the right person (HIGH with company match) and rejects a wrong one by the name gate', async () => {
    const store = new MemoryStore();
    const ok = await executePlay<LinkedinCell>({ store, resolvePlay, play: resolvePlay('person-to-linkedin'), input: { first_name: 'Alice', last_name: 'Dupont', company: 'Chift' }, dryRun: true, log: quiet });
    expect(ok.output).toMatchObject({ value: 'https://www.linkedin.com/in/alice-dupont', confidence: 'HIGH', source: 'serper_company' });
    const wrong = await executePlay<LinkedinCell>({ store, resolvePlay, play: resolvePlay('person-to-linkedin'), input: { first_name: 'Ana', last_name: 'Xu', company: 'Chift' }, dryRun: true, log: quiet });
    expect(wrong.output!.value).toBeNull();
    expect(wrong.receipt.legs.find((l) => l.leg === 'serper_name')!.rowsReached).toBe(1);
    expect([...store.people.values()][0].linkedinUrl).toBe('https://www.linkedin.com/in/alice-dupont');
  });
});

describe('person-to-phone', () => {
  it('finds a mobile at MEDIUM from a single provider and writes the golden phone', async () => {
    const store = new MemoryStore();
    const r = await executePlay<PhoneCell>({ store, resolvePlay, play: resolvePlay('person-to-phone'), input: { first_name: 'Alice', last_name: 'Dupont', domain: 'chift.eu' }, dryRun: true, log: quiet });
    expect(r.output).toMatchObject({ status: 'mobile', confidence: 'MEDIUM', source: 'lusha' });
    expect([...store.people.values()][0].phone).toBe(r.output!.value);
    const later = await executePlay<PhoneCell>({ store, resolvePlay, play: resolvePlay('person-to-phone'), input: { linkedin_url: 'https://www.linkedin.com/in/paul-roux' }, dryRun: true, log: quiet });
    expect(later.output).toMatchObject({ source: 'kaspr', confidence: 'MEDIUM' });
  });
});

describe('person-linkedin-to-email', () => {
  it('walks prospeo → findymail → kaspr and accepts without a domain gate when no domain is given', async () => {
    const store = new MemoryStore();
    const r = await executePlay<EmailCell>({ store, resolvePlay, play: resolvePlay('person-linkedin-to-email'), input: { linkedin_url: 'https://www.linkedin.com/in/alice-dupont', domain: 'chift.eu' }, dryRun: true, log: quiet });
    expect(r.output).toMatchObject({ value: 'alice.dupont@chift.eu', confidence: 'HIGH', source: 'findymail' });
    const byLeg = Object.fromEntries(r.receipt.legs.map((l) => [l.leg, l]));
    expect(byLeg.prospeo.rowsReached).toBe(1);
    expect(byLeg.kaspr.label).toBe('NEVER REACHED');
  });
});
