import { z } from 'zod';
import { definePlay } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { apexDomain } from '../core/normalize.ts';
import { createNotifier } from '../core/notify.ts';
import { callTool } from './market-watch.ts';
import type { Signal } from '../store/store.ts';

export const NAME = 'competitor-watch';
export const DESCRIPTION = 'Diff competitor pages (pricing, integrations, changelog, customers) against the last snapshot in the signals table: lines added and removed become a page_change signal and a Slack digest per competitor. First run is a silent baseline.';

export const Input = z.object({
  pages: z.array(z.object({
    competitor: z.string().min(1),
    url: z.string().url(),
    kind: z.enum(['pricing', 'integrations', 'changelog', 'customers', 'other']).default('other'),
  })).min(1).describe('pages to watch, e.g. {competitor:"Codat", url:"https://www.codat.io/pricing", kind:"pricing"}'),
  notify: z.boolean().default(true),
});
export type Input = z.infer<typeof Input>;
export interface PageResult { competitor: string; url: string; kind: string; status: 'baseline' | 'unchanged' | 'changed' | 'fetch_failed'; added: string[]; removed: string[] }
export interface Output { pages: PageResult[]; changed: number; notified: 'sent' | 'skipped' | 'failed' | 'none'; signals: Signal[] }

const MAX_LINES = 400;
const MAX_DIFF = 20;
const key = (...parts: unknown[]) => sha256(parts.map(String).join('|')).slice(0, 32);
export const snapshotKey = (url: string) => key('page_snapshot', url);

/** Page text → normalized, deduplicated lines (newlines, sentence ends and "·" / "|" separators). */
export function pageLines(text: string): string[] {
  const out = new Set<string>();
  for (const raw of String(text ?? '').split(/\n+|(?<=[.!?])\s+|\s[·|•]\s/)) {
    const l = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (l.length >= 3 && /\p{L}|\d/u.test(l)) out.add(l);
    if (out.size >= MAX_LINES) break;
  }
  return [...out];
}

export const play = definePlay<Input, Output>({
  name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input,
  async run(input, ctx) {
    const now = new Date().toISOString();
    const results: PageResult[] = [];
    const snapshots: Signal[] = [];
    const changes: Signal[] = [];
    const domains = [...new Set(input.pages.map((p) => apexDomain(p.url) ?? p.url))];
    const prior = new Map((await ctx.store.listSignals(domains)).filter((s) => s.type === 'page_snapshot').map((s) => [s.dedupeKey, s]));

    for (const p of input.pages) {
      const domain = apexDomain(p.url) ?? p.url;
      const r = await callTool(ctx, `page:${p.competitor}:${p.kind}`, 'web', 'fetch_page', { url: p.url }); // never cached
      if (!r) { results.push({ ...p, status: 'fetch_failed', added: [], removed: [] }); continue; }
      const lines = pageLines(r.out.text ?? '');
      const text_hash = sha256(lines.join('\n')).slice(0, 32);
      const prev = prior.get(snapshotKey(p.url));
      snapshots.push({ dedupeKey: snapshotKey(p.url), domain, type: 'page_snapshot', source: 'web', observedAt: now, receiptId: r.receipt.id, value: { url: p.url, competitor: p.competitor, kind: p.kind, lines, text_hash } });
      if (!prev) { results.push({ ...p, status: 'baseline', added: [], removed: [] }); continue; }
      const pv = prev.value as { lines?: string[]; text_hash?: string };
      if (pv.text_hash === text_hash) { results.push({ ...p, status: 'unchanged', added: [], removed: [] }); continue; }
      const before = new Set(pv.lines ?? []);
      const now_ = new Set(lines);
      const added = lines.filter((l) => !before.has(l)).slice(0, MAX_DIFF);
      const removed = [...before].filter((l) => !now_.has(l)).slice(0, MAX_DIFF);
      if (!added.length && !removed.length) { results.push({ ...p, status: 'unchanged', added, removed }); continue; } // reorder only
      results.push({ ...p, status: 'changed', added, removed });
      changes.push({ dedupeKey: key('page_change', p.url, text_hash), domain, type: 'page_change', source: 'web', observedAt: now, receiptId: r.receipt.id, value: { competitor: p.competitor, url: p.url, kind: p.kind, added, removed, text_hash, previous_hash: pv.text_hash ?? null } });
    }

    // alert only on changes the store has never seen (same new hash twice = one alert)
    const seen = new Set((await ctx.store.listSignals([...new Set(changes.map((c) => c.domain))])).map((s) => s.dedupeKey));
    const fresh = changes.filter((c) => !seen.has(c.dedupeKey));
    await ctx.store.upsertSignals([...changes, ...snapshots]); // snapshot key is stable per URL: the store keeps the latest

    let notified: Output['notified'] = 'none';
    if (input.notify && fresh.length) {
      const lines: string[] = [];
      for (const comp of [...new Set(fresh.map((c) => String(c.value.competitor)))]) {
        for (const c of fresh.filter((x) => x.value.competitor === comp)) {
          const v = c.value as { kind: string; url: string; added: string[]; removed: string[] };
          lines.push(`• *${comp}* ${v.kind}: +${v.added.length} / -${v.removed.length} ${v.url}${v.added[0] ? ` — "${v.added[0].slice(0, 90)}"` : ''}`);
        }
      }
      notified = await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`Competitor watch: ${fresh.length} page(s) changed\n${lines.slice(0, 10).join('\n')}`);
    }
    const count = (s: PageResult['status']) => results.filter((x) => x.status === s).length;
    ctx.log(`${results.length} pages: ${count('baseline')} baseline, ${count('unchanged')} unchanged, ${count('changed')} changed, ${count('fetch_failed')} failed, slack=${notified}`);
    return { pages: results, changed: fresh.length, notified, signals: fresh };
  },
});
