import type { Cells, RowState } from './types.ts';
import { personKey } from './keys.ts';
import { toRowStates } from './dataset.ts';
import type { PlayCtx } from './play.ts';

export interface DatasetOpts {
  /** Stable row identity. Defaults to personKey (linkedin > email > name+apex). */
  rowKey?: (row: Record<string, string>) => string;
  /** Persisted dataset slug; defaults to the play name. */
  slug?: string;
}

type ColumnResolver = (row: RowState, ctx: PlayCtx) => Promise<unknown> | unknown;
type Step = { kind: 'column'; name: string; fn: ColumnResolver; concurrency: number } | { kind: 'step'; fn: (rows: RowState[], ctx: PlayCtx) => Promise<void> | void };

/**
 * The Deepline `ctx.dataset(...).withColumn(...).run()` equivalent, minimal:
 * rows are upserted into dataset_rows (existing cells kept), each step runs over all rows,
 * cells are saved after every step. A column is skipped for rows that already have it (unless --refresh).
 */
export class DatasetBuilder {
  private steps: Step[] = [];
  constructor(private ctx: PlayCtx, private rows: Record<string, string>[], private opts: DatasetOpts = {}) {}

  withColumn(name: string, fn: ColumnResolver, o: { concurrency?: number } = {}): this {
    this.steps.push({ kind: 'column', name, fn, concurrency: o.concurrency ?? 4 });
    return this;
  }

  /** Whole-table step, for leg-major waterfalls that need every row at once. */
  withStep(fn: (rows: RowState[], ctx: PlayCtx) => Promise<void> | void): this {
    this.steps.push({ kind: 'step', fn });
    return this;
  }

  async run(): Promise<{ datasetId: string; rows: RowState[] }> {
    const { ctx } = this;
    const slug = this.opts.slug ?? ctx.playName;
    const keyFn = this.opts.rowKey ?? personKey;
    const dataset = await ctx.store.ensureDataset(slug, ctx.playName);
    const stored = await ctx.store.upsertRows(dataset.id, this.rows.map((input) => ({ rowKey: keyFn(input), input })));
    const existing = new Map<string, Cells>(stored.map((r) => [r.rowKey, r.cells]));
    const rows = toRowStates(this.rows, existing, keyFn);
    const save = async () => {
      for (const r of rows) await ctx.store.saveCells(dataset.id, r.rowKey, r.cells);
    };
    for (const step of this.steps) {
      if (step.kind === 'step') {
        await step.fn(rows, ctx);
      } else {
        const todo = rows.filter((r) => ctx.refresh || !(step.name in r.cells));
        for (let i = 0; i < todo.length; i += step.concurrency) {
          await Promise.all(todo.slice(i, i + step.concurrency).map(async (r) => {
            r.cells[step.name] = await step.fn(r, ctx);
          }));
        }
      }
      await save();
    }
    return { datasetId: dataset.id, rows };
  }
}
