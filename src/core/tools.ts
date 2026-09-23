import type { Adapter, AdapterCtx, Receipt, ToolInput, ToolResult } from './types.ts';
import { hashInput } from './hash.ts';
import type { Store } from '../store/store.ts';
import { scrub } from '../providers/_adapter.ts';

export interface ExecuteArgs {
  provider: string;
  tool: string;
  input: ToolInput;
  runId?: string;
}

export interface ToolRunnerOpts {
  /** Ignore cached receipts and call the provider again. */
  refresh?: boolean;
  /** Replace every provider with the mock adapter. */
  dryRun?: boolean;
  log?: (msg: string) => void;
  fetchImpl?: typeof fetch;
}

/**
 * The whole cost/idempotency story lives here:
 *   normalize → hash → cache lookup (latest hit|miss) → adapter → receipt with cost.
 * Errors are recorded but never served from cache.
 */
export class ToolRunner {
  private ctx: AdapterCtx;
  constructor(
    private store: Store,
    private registry: Record<string, Adapter>,
    private opts: ToolRunnerOpts = {},
  ) {
    this.ctx = { fetch: opts.fetchImpl ?? fetch, log: opts.log ?? (() => {}) };
  }

  adapter(provider: string): Adapter {
    const name = this.opts.dryRun ? 'mock' : provider;
    const a = this.registry[name];
    if (!a) throw new Error(`Unknown provider: ${name}`);
    return a;
  }

  async execute(args: ExecuteArgs): Promise<Receipt> {
    const [r] = await this.executeBatch({ ...args, inputs: [args.input] });
    return r;
  }

  /** Cache lookup per item; only uncached items reach the provider; one receipt per item. */
  async executeBatch(args: Omit<ExecuteArgs, 'input'> & { inputs: ToolInput[] }): Promise<Receipt[]> {
    const adapter = this.adapter(args.provider);
    const def = adapter.tools[args.tool];
    if (!def) throw new Error(`${adapter.name} has no tool ${args.tool}`);
    const price = adapter.pricing.table[args.tool];

    const normalized = args.inputs.map((i) => def.normalize(i));
    const hashes = normalized.map(hashInput);
    const out: (Receipt | undefined)[] = new Array(args.inputs.length);
    const pending: number[] = [];

    for (let i = 0; i < normalized.length; i++) {
      if (!this.opts.refresh) {
        const cached = await this.store.findLatestReceipt(args.provider, args.tool, hashes[i]);
        if (cached) {
          out[i] = { ...cached, cached: true };
          continue;
        }
      }
      pending.push(i);
    }

    const chunkSize = def.executeBatch ? (def.maxBatch ?? 50) : 1;
    for (let c = 0; c < pending.length; c += chunkSize) {
      const idx = pending.slice(c, c + chunkSize);
      const inputs = idx.map((i) => normalized[i]);
      const started = Date.now();
      let results: ToolResult[];
      try {
        results = def.executeBatch
          ? await def.executeBatch(inputs, this.ctx)
          : [await def.execute!(inputs[0], this.ctx)];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results = inputs.map(() => ({ status: 'error' as const, error: msg }));
      }
      const durationMs = Date.now() - started;
      for (let k = 0; k < idx.length; k++) {
        const res = results[k] ?? { status: 'error' as const, error: 'provider returned fewer results than inputs' };
        const credits = def.cost(res);
        out[idx[k]] = await this.store.insertReceipt({
          provider: args.provider, tool: args.tool, inputHash: hashes[idx[k]], input: inputs[k],
          output: scrub(res.output), status: res.status, pricingBasis: price.basis,
          costCredits: credits, costUsd: round(credits * adapter.pricing.usdPerCredit),
          httpStatus: res.httpStatus, durationMs: Math.round(durationMs / idx.length), error: res.error, runId: args.runId,
        });
        if (res.missReason) (out[idx[k]] as Receipt & { missReason?: string }).missReason = res.missReason;
      }
    }
    return out as Receipt[];
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000;
