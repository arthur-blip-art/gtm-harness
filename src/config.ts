import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/** Repo root. The CLI shim sets GTM_HOME; tests and direct tsx runs fall back to the package dir. */
export const GTM_HOME =
  process.env.GTM_HOME ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

loadDotenv({ path: path.join(GTM_HOME, '.env'), quiet: true });

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing ${name} in ${path.join(GTM_HOME, '.env')}`);
  return v;
}

export const defaults = {
  maxCreditsPerRun: Number(env('GTM_MAX_CREDITS_PER_RUN') ?? 50),
};
