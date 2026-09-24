import { definePlay, steps } from 'deepline';
import type { ColumnMap, CsvInput } from 'deepline';
import type { ContactInput, ContactResult } from './smb-owner-helpers';
import { lookupContact } from './smb-owner-core';

export function smbOwnerContactSteps() {
  return steps<ContactInput>()
    .step('contact_resolution', (row, ctx) => lookupContact(row, ctx))
    .return((row) => row.contact_resolution);
}
export const scalar = definePlay(
  'smb-owner-contact',
  async (ctx, input: ContactInput): Promise<ContactResult> => {
    return ctx.runSteps(smbOwnerContactSteps(), input);
  },
  {
    description:
      'Find validated personal email or mobile for a known SMB contact by exact Enformion person ID. Name and locality searches return review-only identities; email is the default channel.',
  },
);
export const batch = definePlay(
  'smb-owner-contact-batch',
  async (
    ctx,
    input: { csv: CsvInput<ContactInput>; columns?: ColumnMap<ContactInput> },
  ): Promise<Record<string, unknown>> => {
    const people = await ctx.csv<ContactInput>(input.csv, {
      description: 'Load known SMB contacts.',
      columns: {
        tahoe_id: 'tahoe_id',
        first_name: 'first_name',
        last_name: 'last_name',
        city: 'city',
        state: 'state',
        channels: 'channels',
        ...input.columns,
      },
    });
    const rows = await ctx
      .dataset('smb_contact_rows', people)
      .withColumn('contact_result', smbOwnerContactSteps())
      .run({
        description: 'Find identity-bound validated contacts for each row.',
      });
    return { rows };
  },
  {
    description:
      'Validate personal email or mobile for a CSV of known SMB person identifiers.',
  },
);
export default scalar;
