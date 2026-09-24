import { definePlay, steps } from 'deepline';
import type { ColumnMap, CsvInput } from 'deepline';
import type { EntityInput, EntityResult } from './smb-owner-helpers';
import { lookupEntity } from './smb-owner-core';

export function llcToOwnerSteps() {
  return steps<EntityInput>()
    .step('entity_resolution', (row, ctx) => lookupEntity(row, ctx))
    .return((row) => row.entity_resolution);
}
export const scalar = definePlay(
  'llc-to-owner',
  async (ctx, input: EntityInput): Promise<EntityResult> => {
    return ctx.runSteps(llcToOwnerSteps(), input);
  },
  {
    description:
      'Find recorded members and officers of an exact US legal entity. Filing roles are candidate evidence, not confirmation of beneficial ownership.',
  },
);
export const batch = definePlay(
  'llc-to-owner-batch',
  async (
    ctx,
    input: { csv: CsvInput<EntityInput>; columns?: ColumnMap<EntityInput> },
  ): Promise<Record<string, unknown>> => {
    const companies = await ctx.csv<EntityInput>(input.csv, {
      description: 'Load US legal entities.',
      columns: {
        legal_name: 'legal_name',
        state: 'state',
        city: 'city',
        registry_number: 'registry_number',
        ...input.columns,
      },
      required: ['legal_name', 'state'],
    });
    const rows = await ctx
      .dataset('llc_owner_rows', companies)
      .withColumn('owner_result', llcToOwnerSteps())
      .run({ description: 'Resolve filing candidates for each legal entity.' });
    return { rows };
  },
  {
    description:
      'Find recorded member and officer candidates for a CSV of US legal entities.',
  },
);
export default scalar;
