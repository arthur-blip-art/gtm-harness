import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, mentionRanks, type Output } from '../src/plays/aeo-visibility.ts';

const quiet = () => {};
const input = { questions: ['Meilleure API pour connecter son logiciel à Pennylane', 'Unified accounting API Europe', 'Codat alternatives'] };

describe('aeo-visibility (mock)', () => {
  it('measures mention rate, ranks, gaps, and compares with last month', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    const o = r.output!;
    expect(o.answered).toBe(3);
    // mock: Pennylane question → "Chift and Codat"; others → "Codat, Merge and Apideck"
    expect(o.mention_rate).toMatchObject({ Chift: 33, Codat: 100, Merge: 67, Apideck: 67, Rutter: 0 });
    expect(o.answers[0].mentions).toMatchObject({ Chift: 1, Codat: 2, Merge: null });
    expect(o.answers[0].cited_domains).toEqual(['chift.eu', 'codat.io']);
    expect(o.gaps.map((g) => g.question)).toEqual(['Unified accounting API Europe', 'Codat alternatives']);
    expect(o.previous_rate).toBeNull();
    expect(o.notified).toBe('skipped');
    expect(store.signals.size).toBe(3);

    // same month rerun: same dedupe keys; then fake last month's answers to get a delta
    await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(store.signals.size).toBe(3);
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
    const prev = d.toISOString().slice(0, 7);
    for (const [k, s] of [...store.signals]) store.signals.set(`${k}-prev`, { ...s, dedupeKey: `${k}-prev`, value: { ...s.value, month: prev, mentions: { ...(s.value.mentions as object), Chift: null } } });
    const r3 = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r3.output!.previous_rate).toMatchObject({ Chift: 0 });
    expect(r3.output!.delta).toMatchObject({ Chift: 33, Codat: 0 });
  });
  it('ranks whole-word mentions only', () => {
    expect(mentionRanks('Apideck then codat; Merged docs', ['Chift', 'Codat', 'Merge', 'Apideck'])).toEqual({ Chift: null, Codat: 2, Merge: null, Apideck: 1 });
  });
  it('does not count the verb "merge" as Merge', () => {
    expect(mentionRanks('You merge the ledgers, then Codat', ['Merge', 'Codat'])).toEqual({ Merge: null, Codat: 1 });
    expect(mentionRanks('Merge and Codat', ['Merge', 'Codat'])).toEqual({ Merge: 1, Codat: 2 });
  });
  it('the Chift config parses', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'config', 'aeo-visibility.chift.json'), 'utf8'));
    expect(play.input.parse(cfg).questions.length).toBe(8);
  });
});
