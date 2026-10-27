import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, lintSteps, type Output } from '../src/plays/push-sequencer.ts';

const quiet = () => {};
const steps = [
  { subject: 'Pennylane chez {{company}}', body: 'Bonjour {{first_name}},\n\n{{pain_line}}\n\nOn en parle ?', delay_days: 0 },
  { subject: '', body: 'Je me permets de relancer, {{first_name}}.', delay_days: 3 },
];
const lead = (email: string, extra: Record<string, unknown> = {}) => ({ email, first_name: 'Léa', last_name: 'Martin', company: 'Fresh', domain: email.split('@')[1], title: 'CTO', confidence: 'HIGH', variables: { pain_line: 'Vos clients demandent Exact.' }, ...extra });
const leads = [
  lead('lea@fresh.io'),
  lead('low@fresh.io', { confidence: 'LOW' }),
  lead('hold@fresh.io', { confidence: 'HOLD' }),
  lead('novar@fresh.io', { variables: {} }),
  lead('optout@fresh.io'),
  lead('cfo@acme-customer.com'),
  { first_name: 'No', last_name: 'Email' },
];

describe('push-sequencer', () => {
  it('dry_run_only: rejects LOW/HOLD, suppressed and missing variables, never calls Instantly', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input: { campaign: 'q4-test', steps, leads }, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    const o = r.output!;
    expect(o).toMatchObject({ campaign_id: null, pushed: 0, ready: 1, dry_run_only: true, touches_recorded: 0 });
    const reasons = Object.fromEntries(o.rejected.map((x) => [x.email, x.reason]));
    expect(reasons).toMatchObject({
      'low@fresh.io': 'confidence:LOW', 'hold@fresh.io': 'confidence:HOLD', 'novar@fresh.io': 'missing_variable:pain_line',
      'optout@fresh.io': 'suppressed:opted_out', '': 'no_email',
    });
    expect(reasons['cfo@acme-customer.com']).toMatch(/^suppressed:customer/);
    expect(store.receipts.some((x) => x.provider === 'instantly')).toBe(false);
  });
  it('dry_run_only:false (mock) creates a draft, pushes the kept lead and records the touch', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input: { campaign: 'q4-test', steps, leads, dry_run_only: false }, dryRun: true, log: quiet });
    expect(r.output!.campaign_id).toMatch(/^camp_/);
    expect(r.output!).toMatchObject({ pushed: 1, touches_recorded: 1 });
    const tools = store.receipts.filter((x) => x.provider === 'instantly').map((x) => x.tool);
    expect(tools).toEqual(['create_campaign', 'add_leads']);
    const added = store.receipts.find((x) => x.tool === 'add_leads')!.input as any;
    expect(added.leads[0].custom_variables).toMatchObject({ pain_line: 'Vos clients demandent Exact.', title: 'CTO', company: 'Fresh' });
    // second push within the cooldown: the touch suppresses the lead
    const r2 = await executePlay<Output>({ store, resolvePlay, play, input: { campaign: 'q4-test-2', steps, leads: [lead('lea@fresh.io')] }, dryRun: true, log: quiet });
    expect(r2.output!.rejected[0].reason).toMatch(/^suppressed:recently_touched/);
  });
  it('lints the copy: long subject, long first body, link, attachment', () => {
    const w = lintSteps([{ subject: 'x'.repeat(70), body: `${'mot '.repeat(130)} https://chift.eu voir pièce jointe`, delay_days: 0 }, { subject: 'ok', body: 'court', delay_days: 3 }]);
    expect(w.join('\n')).toMatch(/subject is 70 chars/);
    expect(w.join('\n')).toMatch(/words \(> 120\)/);
    expect(w.join('\n')).toMatch(/link/);
    expect(w.join('\n')).toMatch(/attachment/);
  });
});
