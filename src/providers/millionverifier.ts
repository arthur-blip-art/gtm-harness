import { costFromTable, defineAdapter, errorResult, httpJson } from './_adapter.ts';
import { env } from '../config.ts';
import { nameToken, normalizeEmail } from '../core/normalize.ts';
import type { AdapterCtx, ToolResult } from '../core/types.ts';

const PRICE = {
  verify: { basis: 'per_call', credits: 0.01, note: '~$0.001 per verification' },
  verify_patterns: { basis: 'per_call', credits: 0.01, note: 'costOverride = number of patterns actually verified' },
} as const;

async function verifyOne(ctx: AdapterCtx, email: string): Promise<ToolResult> {
  const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(env('MILLIONVERIFIER_API_KEY') ?? '')}&email=${encodeURIComponent(email)}&timeout=10`;
  const { status, body } = await httpJson(ctx, url);
  if (status !== 200) return errorResult(status, body, body?.error);
  if (body?.error) return errorResult(200, body, String(body.error));
  const result = String(body.result ?? 'unknown').toLowerCase();
  const out = { email, result, quality: body.quality, resultcode: body.resultcode, free: body.free, role: body.role };
  return result === 'ok' ? { status: 'hit', output: out } : { status: 'miss', missReason: result, output: out };
}

/** Common corporate patterns, most frequent first. */
export function emailPatterns(first: string, last: string, domain: string): string[] {
  const f = nameToken(first), l = nameToken(last);
  if (!f || !l || !domain) return [];
  return [`${f}.${l}`, `${f}`, `${f[0]}${l}`, `${f[0]}.${l}`, `${f}${l}`, `${f}_${l}`, `${l}`, `${l}.${f}`].map((x) => `${x}@${domain}`);
}

/** MillionVerifier: cheap validator. Used as leg 1 (pattern guess) and as the final check on held candidates. */
export const millionverifier = defineAdapter({
  name: 'millionverifier',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-23 (estimate)', table: PRICE },
  requiredEnv: ['MILLIONVERIFIER_API_KEY'],
  tools: {
    verify: {
      description: 'Verify one email address.',
      normalize: (i) => ({ email: normalizeEmail(i.email) ?? '' }),
      async execute(i, ctx) { return verifyOne(ctx, String(i.email)); },
      cost: costFromTable(PRICE.verify),
    },
    verify_patterns: {
      description: 'Guess common patterns on the apex domain and verify until the first valid one.',
      normalize: (i) => ({ first_name: nameToken(i.first_name), last_name: nameToken(i.last_name), domain: String(i.domain ?? '') }),
      async execute(i, ctx) {
        const patterns = emailPatterns(String(i.first_name), String(i.last_name), String(i.domain));
        const tried: { email: string; result: string }[] = [];
        for (const email of patterns.slice(0, 5)) {
          const r = await verifyOne(ctx, email);
          if (r.status === 'error') return { ...r, costOverride: tried.length * PRICE.verify.credits };
          const result = (r.output as any).result as string;
          tried.push({ email, result });
          if (result === 'ok') return { status: 'hit', output: { email, result, tried }, costOverride: tried.length * PRICE.verify.credits };
          // catch_all domain: every pattern will look the same, stop after the first
          if (result === 'catch_all') return { status: 'miss', missReason: 'catch_all_domain', output: { email, result, tried }, costOverride: tried.length * PRICE.verify.credits };
        }
        return { status: 'miss', missReason: 'no_pattern_valid', output: { tried }, costOverride: tried.length * PRICE.verify.credits };
      },
      cost: costFromTable(PRICE.verify_patterns),
    },
  },
});
