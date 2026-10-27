import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, tierOf, type Output } from '../src/plays/inbound-triage.ts';

const quiet = () => {};
const run = (store: MemoryStore, input: Record<string, unknown> = {}) => executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
const updates = (store: MemoryStore) => store.receipts.filter((r) => r.provider === 'hubspot' && r.tool === 'update');

describe('inbound-triage (HubSpot mock)', () => {
  it('tiers the three fresh contacts and is silent on rerun', async () => {
    const store = new MemoryStore();
    const r1 = await run(store);
    expect(r1.status).toBe('done');
    const by = Object.fromEntries(r1.output!.leads.map((l) => [l.email, l]));
    expect(by['paul.mercier@gmail.com']).toMatchObject({ tier: 'disqualified', next_action: 'refus poli ou referral' });
    expect(by['paul.mercier@gmail.com'].reason).toMatch(/email perso/);
    expect(by['zoe.blanc@retailco.fr']).toMatchObject({ tier: 'disqualified' });
    expect(by['zoe.blanc@retailco.fr'].reason).toMatch(/stagiaire/);
    // mock profile: 120 people, software, France, Salesforce → full fit score → absolute grade A
    const ines = by['ines.garnier@billwise.io'];
    expect(ines).toMatchObject({ tier: 'hot', fit_tier: 'A', domain: 'billwise.io', next_action: 'répondre < 1 h + call-prep' });
    expect(ines.angle).toMatch(/Pennylane/);
    expect(r1.output!.counts).toEqual({ hot: 1, warm: 0, cold: 0, disqualified: 2 });
    expect(r1.output!.new_leads).toBe(3);
    expect(r1.output!.notified).toBe('skipped'); // dry-run never posts
    expect([...store.signals.values()].filter((s) => s.type === 'inbound_lead')).toHaveLength(3);

    const r2 = await run(store);
    expect(r2.output!.new_leads).toBe(0);
    expect(r2.output!.notified).toBe('none');
    expect(r2.output!.counts.hot).toBe(1);
  });

  it('write:false never updates HubSpot; write:true updates every triaged contact', async () => {
    const store = new MemoryStore();
    await run(store, { write: false });
    expect(updates(store)).toHaveLength(0);
    const r = await run(store, { write: true });
    expect(r.output!.written).toBe(3);
    expect(updates(store)).toHaveLength(3);
    expect(updates(store).map((u) => (u.input as any).properties.gtm_inbound_tier).sort()).toEqual(['disqualified', 'disqualified', 'hot']);
  });

  it('takes pasted contacts and disqualifies competitors, own domain and customers', async () => {
    const store = new MemoryStore();
    const r = await run(store, { contacts: [
      { email: 'dev@codat.io', jobtitle: 'Engineer' },
      { email: 'x@chift.eu', jobtitle: 'AE' },
      { email: 'cfo@acme-customer.com', jobtitle: 'CFO' },
      { email: 'pm@fresh.io', jobtitle: 'Product Manager', message: '' },
    ] });
    const by = Object.fromEntries(r.output!.leads.map((l) => [l.email, l]));
    expect(by['dev@codat.io'].reason).toMatch(/concurrent/);
    expect(by['x@chift.eu'].reason).toMatch(/domaine propre/);
    expect(by['cfo@acme-customer.com'].reason).toMatch(/client/);
    expect(by['pm@fresh.io'].tier).toBe('warm'); // good fit, no decider, no intent
  });

  it('tier rule', () => {
    expect(tierOf('B', 'Head of Partnerships', '').tier).toBe('hot');
    expect(tierOf('A', 'Founder', '', 50).tier).toBe('hot');
    expect(tierOf('A', 'Founder', '', 900).tier).toBe('warm');
    expect(tierOf('C', 'CTO', 'need an API').tier).toBe('warm');
    expect(tierOf('D', 'CTO', '').tier).toBe('cold');
    expect(tierOf(null, 'Marketing', '').tier).toBe('cold');
  });
});
