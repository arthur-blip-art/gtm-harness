import type { ZodType } from 'zod';
import type { LegMeta, RowState } from './types.ts';
import type { ToolRunner } from './tools.ts';
import type { Store } from '../store/store.ts';
import type { FieldPolicy, Leg } from './waterfall.ts';
import { runWaterfall } from './waterfall.ts';
import { DatasetBuilder, type DatasetOpts } from './batch.ts';

export type PlayKind = 'scalar' | 'batch' | 'pipeline';

export interface Play<I = any, O = any> {
  name: string;
  description: string;
  kind: PlayKind;
  input: ZodType<I>;
  run(input: I, ctx: PlayCtx): Promise<O>;
}

/**
 * Everything a play can touch. Children created through `runPlay` share runId, runner, store
 * and `metas`, so the whole tree produces one receipt and one cache scope.
 */
export interface PlayCtx {
  runId: string;
  playName: string;
  runner: ToolRunner;
  store: Store;
  log: (msg: string) => void;
  dryRun: boolean;
  refresh: boolean;
  legs?: string[];
  maxCredits?: number;
  metas: LegMeta[];
  /** Credits spent so far in this run (non-cached receipts), updated by waterfalls. */
  spent: { credits: number };
  runPlay<I, O>(play: Play<I, O> | string, input: I): Promise<O>;
  waterfall(rows: RowState[], legs: Leg[], policy: FieldPolicy<any>): Promise<LegMeta[]>;
  dataset(rows: Record<string, string>[], opts?: DatasetOpts): DatasetBuilder;
  resolvePlay(name: string): Play;
}

export function definePlay<I, O>(p: Omit<Play<I, O>, 'kind'> & { kind?: PlayKind }): Play<I, O> {
  return { kind: 'scalar', ...p };
}

export interface RootCtxOpts {
  runId: string;
  playName: string;
  runner: ToolRunner;
  store: Store;
  log?: (msg: string) => void;
  dryRun: boolean;
  refresh?: boolean;
  legs?: string[];
  maxCredits?: number;
  resolvePlay: (name: string) => Play;
}

export function createCtx(o: RootCtxOpts): PlayCtx {
  const log = o.log ?? (() => {});
  const ctx: PlayCtx = {
    runId: o.runId, playName: o.playName, runner: o.runner, store: o.store, log, dryRun: o.dryRun,
    refresh: o.refresh ?? false, legs: o.legs, maxCredits: o.maxCredits, metas: [], spent: { credits: 0 },
    resolvePlay: o.resolvePlay,
    async runPlay(play, input) {
      const p = typeof play === 'string' ? o.resolvePlay(play) : play;
      const parsed = p.input.parse(input);
      const child: PlayCtx = { ...ctx, playName: p.name, log: (m) => log(`[${p.name}] ${m}`) };
      // share mutable state explicitly (spread copies references, which is what we want)
      child.metas = ctx.metas;
      child.spent = ctx.spent;
      return p.run(parsed, child);
    },
    async waterfall(rows, legs, policy) {
      const metas = await runWaterfall(rows, legs, ctx.runner, {
        runId: ctx.runId, policy, maxCredits: ctx.maxCredits, spent: ctx.spent, log: ctx.log,
      });
      ctx.metas.push(...metas);
      return metas;
    },
    dataset(rows, opts) {
      return new DatasetBuilder(ctx, rows, opts);
    },
  };
  return ctx;
}
