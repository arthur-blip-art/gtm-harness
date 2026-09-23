import { costFromTable, defineAdapter } from './_adapter.ts';
import { nameToken } from '../core/normalize.ts';
import type { ToolInput, ToolResult } from '../core/types.ts';

/**
 * Deterministic fake provider for --dry-run and tests. Behaviour is a function of the input only:
 * the last name's first letter decides which leg "finds" the email, so a 3-row CSV exercises
 * leg 1 (a–h), leg 2 (i–p), leg 3 (q–z) and misses for names starting with a digit or 'x'.
 */
function bucket(input: ToolInput): 'pattern' | 'apollo' | 'fullenrich' | 'none' {
  const last = nameToken(input.last_name ?? input.lastname ?? '');
  const c = last[0] ?? 'x';
  if (c === 'x') return 'none';
  if (c <= 'h') return 'pattern';
  if (c <= 'p') return 'apollo';
  return 'fullenrich';
}

function email(input: ToolInput): string {
  return `${nameToken(input.first_name)}.${nameToken(input.last_name)}@${String(input.domain)}`;
}

function verdict(self: string, input: ToolInput, rawStatus: string): ToolResult {
  if (input.email) {
    // verifier mode (pattern leg): valid iff bucket is pattern and it's the first.last pattern
    const ok = bucket(input) === 'pattern' && String(input.email).startsWith(`${nameToken(input.first_name)}.`);
    return ok
      ? { status: 'hit', output: { email: input.email, result: 'ok' } }
      : { status: 'miss', missReason: 'no_match', output: { email: input.email, result: 'invalid' } };
  }
  return bucket(input) === self
    ? { status: 'hit', output: { email: email(input), email_status: rawStatus } }
    : { status: 'miss', missReason: 'no_match', output: {} };
}

const norm = (i: ToolInput) => ({
  first_name: nameToken(i.first_name), last_name: nameToken(i.last_name), domain: String(i.domain ?? ''),
  ...(i.email ? { email: String(i.email) } : {}),
});

export const mock = defineAdapter({
  name: 'mock',
  pricing: {
    usdPerCredit: 0.1,
    verifiedOn: '2026-09-23',
    table: {
      verify: { basis: 'per_call', credits: 0.01 },
      verify_patterns: { basis: 'per_call', credits: 0.01 },
      search: { basis: 'per_call', credits: 0.05 },
      people_match: { basis: 'per_hit', credits: 1 },
      bulk_enrich: { basis: 'per_hit', credits: 1 },
      person_enrich: { basis: 'per_hit', credits: 3 },
    },
  },
  requiredEnv: [],
  tools: {
    verify: {
      description: 'mock email verifier (single address)', normalize: (i) => ({ email: String(i.email ?? '') }),
      async execute(i) {
        const e = String(i.email);
        const ok = /^[a-h]/.test(e.split('@')[0].split('.')[1] ?? 'x') || /hold/.test(e);
        return ok ? { status: 'hit', output: { email: e, result: 'ok' } } : { status: 'miss', missReason: 'invalid', output: { email: e, result: 'invalid' } };
      },
      cost: costFromTable({ basis: 'per_call', credits: 0.01 }),
    },
    verify_patterns: {
      description: 'mock pattern guesser', normalize: norm,
      async execute(i) { return verdict('pattern', i, 'ok'); },
      cost: costFromTable({ basis: 'per_call', credits: 0.01 }),
    },
    search: {
      description: 'mock web search (company → website)', normalize: (i) => ({ query: String(i.query ?? '') }),
      async execute(i) {
        const word = String(i.query).replace(/official website/i, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        return { status: 'hit', output: { results: [{ url: `https://www.${word || 'example'}.com/`, title: word }] } };
      },
      cost: costFromTable({ basis: 'per_call', credits: 0.05 }),
    },
    people_match: {
      description: 'mock apollo', normalize: norm,
      async execute(i) { return verdict('apollo', i, 'verified'); },
      cost: costFromTable({ basis: 'per_hit', credits: 1 }),
    },
    bulk_enrich: {
      description: 'mock fullenrich (batch)', normalize: norm, maxBatch: 50,
      async executeBatch(inputs) { return inputs.map((i) => verdict('fullenrich', i, 'DELIVERABLE')); },
      cost: costFromTable({ basis: 'per_hit', credits: 1 }),
    },
    person_enrich: {
      description: 'mock pdl', normalize: norm,
      async execute() { return { status: 'miss', missReason: 'no_match', output: {} }; },
      cost: costFromTable({ basis: 'per_hit', credits: 3 }),
    },
  },
});
