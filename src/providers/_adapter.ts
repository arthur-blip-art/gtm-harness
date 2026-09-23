import type { Adapter, AdapterCtx, PriceEntry, ToolResult } from '../core/types.ts';

export class ProviderError extends Error {
  constructor(message: string, public httpStatus?: number, public transient = false) {
    super(message);
  }
}

/** JSON fetch with retry on 429/5xx (exponential backoff), never on 4xx. */
export async function httpJson(
  ctx: AdapterCtx,
  url: string,
  init: RequestInit & { retries?: number } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const retries = init.retries ?? 3;
  let attempt = 0;
  for (;;) {
    const res = await ctx.fetch(url, init);
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { _raw: text.slice(0, 2000) };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** attempt;
      ctx.log(`HTTP ${res.status} from ${new URL(url).host}, retry ${attempt + 1}/${retries} in ${wait}ms`);
      await sleep(wait);
      attempt++;
      continue;
    }
    return { status: res.status, body, headers: res.headers };
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function errorResult(status: number, body: unknown, msg?: string): ToolResult {
  return { status: 'error', httpStatus: status, error: msg ?? `HTTP ${status}`, output: scrub(body) };
}

/** Cost from the adapter's static table; costOverride wins when the provider reports exact spend. */
export function costFromTable(entry: PriceEntry) {
  return (result: ToolResult): number => {
    if (typeof result.costOverride === 'number') return result.costOverride;
    if (result.status === 'error') return 0;
    switch (entry.basis) {
      case 'free':
        return 0;
      case 'per_hit':
      case 'per_result':
        return result.status === 'hit' ? entry.credits : 0;
      case 'per_call':
      case 'unknown':
        return entry.credits;
    }
  };
}

/** Drop anything that looks like a secret before persisting a payload. */
export function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/api[_-]?key|token|secret|authorization|password/i.test(k)) continue;
      out[k] = scrub(val);
    }
    return out;
  }
  return v;
}

export function pick<T extends Record<string, unknown>>(obj: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') out[k] = obj[k];
  return out;
}

export function defineAdapter(a: Adapter): Adapter {
  for (const [tool, def] of Object.entries(a.tools)) {
    if (!a.pricing.table[tool]) throw new Error(`${a.name}: no price entry for tool ${tool}`);
    if (!def.execute && !def.executeBatch) throw new Error(`${a.name}.${tool}: needs execute or executeBatch`);
  }
  return a;
}
