import { createHash } from 'node:crypto';

/** Deterministic JSON: sorted keys, no undefined, arrays kept in order. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function hashInput(input: unknown): string {
  return sha256(canonical(input));
}
