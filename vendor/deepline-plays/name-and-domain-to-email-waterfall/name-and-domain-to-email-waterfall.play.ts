/**
 * This play's step program lives in `./name-and-domain-to-email-waterfall-core`,
 * so there is no per-provider statement in this file to annotate and every box
 * below is declared a sketch. It names the real provider order; the per-cell
 * trace comes from the batch export, which runs the same steps inline and binds
 * its columns.
 *
 * Only the steps that can actually execute are drawn. `native_email`,
 * `fullenrich_email`, `lusha_email`, and `contactout_email` are pinned
 * `runIf: () => false` in the core module, and a sketch cannot carry the "off"
 * badge that marks a disabled leg, so drawing them would read as live.
 */
/** @mermaid scalar
 * flowchart TD
 * subgraph cascade["Try each source until one returns an email"]
 *   patterns(["Guess common address patterns"]) --> hunter(["Hunter"])
 *   hunter --> leadmagic(["LeadMagic"])
 *   leadmagic --> datagma(["Datagma"])
 *   datagma --> findymail(["Findymail"])
 *   findymail --> icypeas(["Icypeas"])
 *   icypeas --> prospeo(["Prospeo · verified addresses only"])
 *   prospeo --> pdl_email(["PDL · work email required"])
 *   pdl_email --> answer(["Return the email and how it was found"])
 * end
 * class patterns sketch
 * class hunter sketch
 * class leadmagic sketch
 * class datagma sketch
 * class findymail sketch
 * class icypeas sketch
 * class prospeo sketch
 * class pdl_email sketch
 * class answer sketch
 */
/** @mermaid batch
 * flowchart TD
 * leads[("Contact rows")] --> emails[("Email rows")]
 * emails --> loop
 * subgraph loop["For each contact"]
 *   waterfall["Cascade providers for a work email"]
 * end
 * loop --> out["Return enriched rows"]
 */
import { definePlay } from 'deepline';
import type { ColumnMap, CsvInput } from 'deepline';
import {
  DEFAULT_COLUMNS,
  emailResultAttempts,
  emailResultField,
  emailResultWaterfallAttempts,
  nameAndDomainToEmailWaterfallHandler,
  personToEmailSteps,
  type PersonData,
} from './name-and-domain-to-email-waterfall-core';

export * from './name-and-domain-to-email-waterfall-core';

export const scalar = definePlay(
  'name-and-domain-to-email-waterfall',
  nameAndDomainToEmailWaterfallHandler,
  {
    description:
      'Find a mailbox-verified work email at the supplied company domain, cascading across providers until one returns a matching hit.',
    inline: true,
  },
);

export const batch = definePlay(
  'name-and-domain-to-email-waterfall-batch',
  async (
    ctx,
    input: { csv: CsvInput<PersonData>; columns?: ColumnMap<PersonData> },
  ): Promise<Record<string, unknown>> => {
    // @mermaid-node leads type:"dataset" out:"leads"
    const leads = await ctx.csv<PersonData>(input.csv, {
      description: 'Load contact rows for work-email resolution.',
      columns: { ...DEFAULT_COLUMNS, ...input.columns },
      required: ['first_name', 'last_name', 'domain'],
    });
    // @mermaid-node emails type:"dataset" out:"rows"
    const rows = await ctx
      .dataset('email_rows', leads)
      // @mermaid-node waterfall out:"email_result"
      .withColumn('email_result', personToEmailSteps<PersonData>())
      .withColumn('email', (row) => emailResultField(row, 'email'))
      .withColumn('email_source', (row) => emailResultField(row, 'source'))
      .withColumn('email_validated', (row) =>
        emailResultField(row, 'validated'),
      )
      .withColumn('email_attempts', (row) => emailResultAttempts(row))
      .withColumn('waterfall_attempts', (row) =>
        emailResultWaterfallAttempts(row),
      )
      .run({
        description: 'Resolve a verified work email for each contact row.',
      });
    // @mermaid-node out out:"$output"
    return { rows };
  },
  {
    description:
      'Resolve mailbox-verified work emails at each supplied company domain for a CSV of contacts with first name, last name, and company domain columns.',
  },
);

export default scalar;
