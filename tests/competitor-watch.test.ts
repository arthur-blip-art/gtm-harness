import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, pageLines, snapshotKey, type Output } from '../src/plays/competitor-watch.ts';

const quiet = () => {};
const input = { pages: [
  { competitor: 'Codat', url: 'https://www.codat.io/pricing', kind: 'pricing' },
  { competitor: 'Merge', url: 'https://www.merge.dev/integrations', kind: 'integrations' },
] };

describe('competitor-watch (mock)', () => {
  it('baseline, then unchanged, then a simulated change alerts once', async () => {
    const store = new MemoryStore();
    const r1 = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r1.output!.pages.map((p) => p.status)).toEqual(['baseline', 'baseline']);
    expect(r1.output!.notified).toBe('none');

    const r2 = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r2.output!.pages.map((p) => p.status)).toEqual(['unchanged', 'unchanged']);

    // pretend last week's pricing page had a different Growth price
    const snap = store.signals.get(snapshotKey('https://www.codat.io/pricing'))!;
    const lines = (snap.value.lines as string[]).map((l) => l.replace('€499', '€399'));
    store.signals.set(snap.dedupeKey, { ...snap, value: { ...snap.value, lines, text_hash: 'old' } });
    const r3 = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    const codat = r3.output!.pages[0];
    expect(codat.status).toBe('changed');
    expect(codat.added).toEqual(['Growth €499/month']);
    expect(codat.removed).toEqual(['Growth €399/month']);
    expect(r3.output!.changed).toBe(1);
    expect(r3.output!.notified).toBe('skipped'); // dry-run never posts
    expect([...store.signals.values()].filter((s) => s.type === 'page_change')).toHaveLength(1);
    // the snapshot was replaced by the latest version
    expect(store.signals.get(snapshotKey('https://www.codat.io/pricing'))!.value.lines).toContain('Growth €499/month');

    const r4 = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r4.output!.changed).toBe(0);
  });
  it('splits text into normalized lines', () => {
    expect(pageLines('Starter €0 · Growth  €499/month\n\nOk. Next one!\n·\n-')).toEqual(['Starter €0', 'Growth €499/month', 'Ok.', 'Next one!']);
  });
  it('the Chift config parses', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'config', 'competitor-watch.chift.json'), 'utf8'));
    expect(play.input.parse(cfg).pages.length).toBeGreaterThan(10);
  });
});
