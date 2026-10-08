import Anthropic from '@anthropic-ai/sdk';
import { defineAdapter } from './_adapter.ts';
import { env } from '../config.ts';
import type { ToolResult } from '../core/types.ts';

/**
 * The judgment steps of the engine, run inside the plays so they need no human and no Claude Code
 * session: read a company's pages and say what it sells and why now, pick the strongest dated
 * fact, draft a sequence. Structured outputs only (a JSON schema per task), so a play reads
 * fields, never prose. Cached by (task, model, prompt, schema) like any other receipt.
 *
 * Model: GTM_LLM_MODEL, default claude-opus-5-5 at low effort. Extraction and short copy also
 * run well on claude-haiku-5-5 ($0.10 / $0.50 per MTok), the cheapest option: set it in .env.
 * Credits are cents: 1 credit = $0.01, computed from the usage the API reports.
 */
const PRICES_PER_MTOK: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-fable-5-1': [10, 50],
};
const PRICE = { generate: { basis: 'per_call', credits: 1, note: 'exact cost from token usage (1 credit = $0.01)' } } as const;

export const DEFAULT_MODEL = () => env('GTM_LLM_MODEL') ?? 'claude-opus-5-5';

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic());

async function generate(i: Record<string, unknown>): Promise<ToolResult> {
  const model = String(i.model);
  // Server-side fallback on a policy decline, where the model supports it (not on Haiku).
  const withFallback = model !== 'claude-haiku-5-5';
  try {
    const res = await api().beta.messages.create({
      model,
      max_tokens: Number(i.max_tokens ?? 8000),
      system: String(i.system),
      messages: [{ role: 'user', content: String(i.prompt) }],
      output_config: { effort: (i.effort as 'low' | 'medium' | 'high') ?? 'low', format: { type: 'json_schema', schema: i.schema as Record<string, unknown> } },
      ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    const [inUsd, outUsd] = PRICES_PER_MTOK[res.model] ?? PRICES_PER_MTOK[model] ?? [4, 20];
    const usd = (res.usage.input_tokens * inUsd + res.usage.output_tokens * outUsd) / 1e6;
    const costOverride = Math.round(usd * 100 * 10000) / 10000;
    if (res.stop_reason === 'refusal') return { status: 'miss', missReason: 'refusal', output: { task: i.task, stop_details: res.stop_details ?? null }, costOverride };
    if (res.stop_reason === 'max_tokens') return { status: 'error', error: 'max_tokens reached before the JSON closed', output: { task: i.task }, costOverride };
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let json: unknown;
    try { json = JSON.parse(text); } catch { return { status: 'error', error: 'model output is not valid JSON', output: { task: i.task, text: text.slice(0, 500) }, costOverride }; }
    return { status: 'hit', output: { task: i.task, model: res.model, result: json, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } }, costOverride };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) return { status: 'error', error: `transient: ${e.message}` };
    if (e instanceof Anthropic.APIError) return { status: 'error', httpStatus: e.status, error: e.message };
    throw e;
  }
}

export const llm = defineAdapter({
  name: 'llm',
  pricing: { usdPerCredit: 0.01, verifiedOn: '2026-10-06 (Anthropic list prices)', table: PRICE },
  requiredEnv: ['ANTHROPIC_API_KEY'],
  tools: {
    generate: {
      description: 'One structured-output call: {task, system, prompt, schema} → JSON matching the schema.',
      normalize: (i) => ({ task: String(i.task ?? 'generic'), model: String(i.model ?? DEFAULT_MODEL()), effort: String(i.effort ?? 'low'), system: String(i.system ?? ''), prompt: String(i.prompt ?? ''), schema: i.schema ?? { type: 'object' }, ...(i.max_tokens ? { max_tokens: Number(i.max_tokens) } : {}) }),
      execute: (i) => generate(i),
      cost: (r) => (typeof r.costOverride === 'number' ? r.costOverride : 0),
    },
  },
});
