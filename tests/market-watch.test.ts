import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, classify, canonicalUrl, type Output } from '../src/plays/market-watch.ts';

const quiet = () => {};
const comps = ['Codat', 'Merge.dev', 'Apideck'];

describe('market-watch (mock)', () => {
  it('pulls news + HN, dedupes by URL, classifies, idempotent on rerun', async () => {
    const store = new MemoryStore();
    const input = { keywords: ['Codat', 'e-invoicing'], competitors: comps };
    const r = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r.status).toBe('done');
    // 2 news per keyword + one HN item shared by both keywords (same URL)
    expect(r.output!.seen).toBe(5);
    expect(r.output!.by_category).toMatchObject({ competitor: 2, regulation: 2, pain: 1 });
    expect([...store.signals.values()].filter((s) => s.type === 'hn_mention')).toHaveLength(1);
    expect([...store.signals.values()].every((s) => s.domain.startsWith('market:'))).toBe(true);
    expect(r.output!.notified).toBe('skipped');

    const r2 = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r2.output!.new_items).toBe(0);
    expect(r2.output!.notified).toBe('none');
  });
  it('classifies by rules', () => {
    expect(classify('Pennylane lève 75 M€', comps)).toBe('funding');
    expect(classify('La réforme de la facture électronique repoussée', comps)).toBe('regulation');
    expect(classify('Apideck launches a new connector', comps)).toBe('competitor');
    expect(classify('We built it ourselves and it was a nightmare', comps)).toBe('pain');
    expect(classify('Qonto partners with Xero', comps)).toBe('partnership');
    expect(classify('Il relance son freelance', comps)).toBe('other');
    expect(classify('We merge branches daily', comps)).toBe('other');
  });
  it('canonicalizes URLs', () => {
    expect(canonicalUrl('https://News.example.com/a/?utm_source=x#top')).toBe('https://news.example.com/a');
  });
  it('the Chift config parses', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'config', 'market-watch.chift.json'), 'utf8'));
    expect(play.input.parse(cfg).keywords.length).toBeGreaterThan(4);
  });
});
