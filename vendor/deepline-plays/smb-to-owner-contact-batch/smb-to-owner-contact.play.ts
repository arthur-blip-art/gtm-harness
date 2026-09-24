import { definePlay, steps } from 'deepline';
import type { ColumnMap, CsvInput } from 'deepline';
import { lookupEntity, lookupContact } from './smb-owner-core';
import {
  soleContactCandidate,
  type ContactInput,
  type ContactResult,
  type EntityInput,
  type EntityResult,
} from './smb-owner-helpers';

type Input = EntityInput & { channels?: ContactInput['channels'] };
type Result = {
  entity: EntityResult;
  contact: ContactResult | null;
  contact_status:
    | 'resolved'
    | 'no_validated_contact'
    | 'review_required'
    | 'no_entity_match';
};
export function smbToOwnerContactSteps() {
  return steps<Input>()
    .step('entity_resolution', (row, ctx) => lookupEntity(row, ctx))
    .step(
      'contact_resolution',
      async (row, ctx): Promise<ContactResult | null> => {
        const candidate = soleContactCandidate(row.entity_resolution);
        if (!candidate?.tahoe_id) return null;
        return lookupContact(
          { tahoe_id: candidate.tahoe_id, channels: row.channels },
          ctx,
        );
      },
    )
    .return(
      (row): Result => ({
        entity: row.entity_resolution,
        contact: row.contact_resolution,
        contact_status:
          row.entity_resolution.entity_match === 'not_found'
            ? 'no_entity_match'
            : row.contact_resolution === null
              ? 'review_required'
              : row.contact_resolution.personal_email.value ||
                  row.contact_resolution.mobile.value
                ? 'resolved'
                : 'no_validated_contact',
      }),
    );
}
export const scalar = definePlay(
  'smb-to-owner-contact',
  async (ctx, input: Input): Promise<Result> => {
    return ctx.runSteps(smbToOwnerContactSteps(), input);
  },
  {
    description:
      'Resolve an exact US legal entity to its recorded principals and validate contact for one unambiguous, active filing candidate with a person ID. Preserves unresolved entity and contact results; does not confirm beneficial ownership.',
  },
);
export const batch = definePlay(
  'smb-to-owner-contact-batch',
  async (
    ctx,
    input: { csv: CsvInput<Input>; columns?: ColumnMap<Input> },
  ): Promise<Record<string, unknown>> => {
    const companies = await ctx.csv<Input>(input.csv, {
      description: 'Load US legal entities for principal contact lookup.',
      columns: {
        legal_name: 'legal_name',
        state: 'state',
        city: 'city',
        registry_number: 'registry_number',
        channels: 'channels',
        ...input.columns,
      },
      required: ['legal_name', 'state'],
    });
    const rows = await ctx
      .dataset('smb_owner_contact_rows', companies)
      .withColumn('owner_contact_result', smbToOwnerContactSteps())
      .run({
        description:
          'Resolve each entity and contact its unambiguous recorded principal.',
      });
    return { rows };
  },
  {
    description:
      'Resolve a CSV of exact US legal entities to recorded principal candidates and validated contacts.',
  },
);
export default scalar;
