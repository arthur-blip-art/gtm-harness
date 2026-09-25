import { z, type ZodType } from 'zod';
import type { Candidate, FieldCell, RowState } from './types.ts';
import type { Play, PlayCtx } from './play.ts';
import { definePlay } from './play.ts';
import type { Store } from '../store/store.ts';
import { personKey } from './keys.ts';
import { apexDomain } from './normalize.ts';

export const BatchInput = z.object({
  rows: z.array(z.record(z.string(), z.string())),
  slug: z.string().optional(),
});
export type BatchInput = z.infer<typeof BatchInput>;

export interface BatchOutput {
  rows: RowState[];
  field: string;
  legIds: string[];
  datasetId: string;
}

export interface RowPlaySpec<I extends Record<string, unknown>, O> {
  name: string;
  description: string;
  input: ZodType<I>;
  /** The field this play fills (email, phone, linkedin_url) — or a custom cell name. */
  field: string;
  legIds: string[];
  /** Shared steps factory: the scalar play runs it on one row, the batch play on every CSV row. */
  steps(rows: RowState[], ctx: PlayCtx): Promise<void>;
  output(row: RowState): O;
  golden?(rows: RowState[], store: Store): Promise<void>;
  rowKey?: (row: Record<string, string>) => string;
}

/**
 * The agent-first CLI pattern, minimal: one file, one steps factory, `scalar` and `batch` exports.
 * Batch rows that already carry a HIGH value for the field are seeded as accepted and skipped by the waterfall.
 */
export function defineRowPlay<I extends Record<string, unknown>, O>(spec: RowPlaySpec<I, O>): { scalar: Play<I, O>; batch: Play<BatchInput, BatchOutput> } {
  const scalar = definePlay<I, O>({
    name: spec.name, description: spec.description, kind: 'scalar', input: spec.input,
    async run(input, ctx) {
      const record = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v == null ? '' : String(v)]));
      if (record.domain) record.domain = apexDomain(record.domain) ?? record.domain;
      const row: RowState = { rowKey: (spec.rowKey ?? personKey)(record), input: record, cells: {}, candidates: {} };
      await spec.steps([row], ctx);
      if (spec.golden) await spec.golden([row], ctx.store);
      return spec.output(row);
    },
  });
  const batch = definePlay<BatchInput, BatchOutput>({
    name: `${spec.name}:batch`, description: `${spec.description} (batch over CSV rows)`, kind: 'batch', input: BatchInput,
    async run(input, ctx) {
      const { datasetId, rows } = await ctx
        .dataset(input.rows, { slug: input.slug, rowKey: spec.rowKey })
        .withStep(async (rows, ctx) => {
          for (const r of rows) seedAccepted(r, spec.field, ctx.refresh);
          await spec.steps(rows, ctx);
        })
        .run();
      if (spec.golden) await spec.golden(rows, ctx.store);
      return { rows, field: spec.field, legIds: spec.legIds, datasetId };
    },
  });
  return { scalar, batch };
}

function seedAccepted(row: RowState, field: string, refresh: boolean) {
  if (refresh) return;
  const cell = row.cells[field] as FieldCell | undefined;
  if (cell?.value && cell.confidence === 'HIGH') {
    const c: Candidate = { value: cell.value, status: cell.status ?? 'valid', source: cell.source ?? 'cached' };
    (row.candidates[field] ??= []).push(c);
  }
}
