import { env } from '../config.ts';
import { MemoryStore } from './memory.ts';
import { PgStore } from './pg.ts';
import type { Store } from './store.ts';

/** --dry-run and --no-db both keep receipts in memory: nothing is cached across runs, live providers still bill. */
export function openStore(opts: { dryRun?: boolean; db?: boolean }): Store {
  if (opts.dryRun || opts.db === false) return new MemoryStore();
  const url = env('DATABASE_URL');
  if (!url || url.includes('<')) {
    throw new Error('DATABASE_URL is not set (or still the .env.example placeholder). Add the Supabase session pooler URL, or pass --no-db to run live without a database.');
  }
  return new PgStore(url);
}
export type { Store } from './store.ts';
export { MemoryStore } from './memory.ts';
