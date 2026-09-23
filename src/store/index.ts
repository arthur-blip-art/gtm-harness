import { env } from '../config.ts';
import { MemoryStore } from './memory.ts';
import { PgStore } from './pg.ts';
import type { Store } from './store.ts';

export function openStore(opts: { dryRun?: boolean }): Store {
  if (opts.dryRun) return new MemoryStore();
  const url = env('DATABASE_URL');
  if (!url) {
    throw new Error('DATABASE_URL is not set. Add it to .env (Supabase session pooler URL) or pass --dry-run.');
  }
  return new PgStore(url);
}
export type { Store } from './store.ts';
export { MemoryStore } from './memory.ts';
