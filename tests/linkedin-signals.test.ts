import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import type { Output } from '../src/plays/linkedin-signals.ts';

const quiet = () => {};
const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'config', 'linkedin-signals.chift.json'), 'utf8'));

describe('linkedin-signals (HarvestAPI, mock)', () => {
  it('runs the three agents, flags ICP titles, and is idempotent on rerun', async () => {
    const store = new MemoryStore();
    const r1 = await executePlay<Output>({ store, resolvePlay, play: resolvePlay('linkedin-signals'), input: config, dryRun: true, log: quiet });
    expect(r1.status).toBe('done');
    const o = r1.output!;
    // 5 keywords × 2 posts, 4 competitors × (2 reactions + 1 comment), 4 profiles → 2 with posts (slugs starting with s/a: sylvainrousseau)
    expect(o.by_type.linkedin_keyword_post).toBe(10);
    expect(o.by_type.linkedin_competitor_engagement).toBe(12);
    expect(o.by_type.linkedin_tracked_post).toBe(1);
    expect(o.icp_matches).toBeGreaterThanOrEqual(5 + 8 + 1); // CTO Léa Martin ×5, Sara Cohen + Nina Rossi ×4, tracked ×1
    expect(o.notified).toBe('skipped'); // dry-run never posts to Slack
    expect(store.signals.size).toBe(23);
    expect(r1.receipt.totalCredits).toBeGreaterThan(0);

    const r2 = await executePlay<Output>({ store, resolvePlay, play: resolvePlay('linkedin-signals'), input: config, dryRun: true, log: quiet });
    expect(r2.output!.new_signals).toBe(0);
    expect(r2.newReceipts).toBe(0); // same week window → same receipts served from cache
    expect(r2.output!.notified).toBe('none');
  });
  it('does nothing without a key outside dry-run', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play: resolvePlay('linkedin-signals'), input: { keywords: ['x'] }, dryRun: false, log: quiet });
    expect(r.output).toMatchObject({ new_signals: 0, notified: 'none' });
  });
});
