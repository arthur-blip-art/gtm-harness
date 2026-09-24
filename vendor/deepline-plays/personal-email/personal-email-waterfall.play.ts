/** @mermaid scalar
 * flowchart TD
 * handle["Read the LinkedIn handle"] --> cascade
 * subgraph cascade["Try each source until one returns a personal email"]
 *   contactout["ContactOut"] --> aviato["Aviato"]
 *   aviato --> limadata["LimaData"]
 *   limadata --> leadmagic["LeadMagic"]
 *   leadmagic --> wiza["Wiza"]
 *   wiza --> icypeas["Icypeas"]
 *   icypeas --> forager["Forager"]
 *   forager --> datagma["Datagma"]
 *   datagma --> pdl["PDL · personal email required"]
 * end
 * cascade --> answer["Return the email and where it came from"]
 */
/** @mermaid batch
 * flowchart TD
 * contacts[("Contact rows")] --> personal[("Personal email rows")]
 * personal --> loop
 * subgraph loop["For each contact"]
 *   identifier["Read the LinkedIn handle"] --> waterfall["Cascade providers for a personal email"]
 * end
 * loop --> out["Return enriched rows"]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { definePlay, isProviderUnavailable, steps } from 'deepline';
import type { ColumnMap, CsvInput } from 'deepline';

import {
  extractAviatoPersonalEmail,
  PERSONAL_EMAIL_SOURCE_FIELDS,
  priorPersonalEmailSourceFields,
  stringOrNull,
  validPersonalEmail,
  type PersonalEmailSourceField,
} from './personal-email-waterfall-helpers';
import {
  noResultWaterfallAttempt,
  unavailableWaterfallAttempt,
  waterfallAttempts,
} from './waterfall-attempts';

type PersonalEmailInput = Record<string, unknown> & {
  first_name: string;
  last_name: string;
  linkedin_url?: string;
  domain?: string;
  company_name?: string;
  linkedin_public_identifier?: string;
};

type PersonalEmailWaterfallRow = PersonalEmailInput & {
  contactout_personal?: unknown;
  aviato_personal?: unknown;
  limadata_personal?: unknown;
  leadmagic_personal?: unknown;
  wiza_personal?: unknown;
  icypeas_personal?: unknown;
  forager_personal?: unknown;
  datagma_personal?: unknown;
  pdl_personal?: unknown;
};

type PersonalEmailWaterfallResult = {
  email: string | null;
  source: string | null;
  validated: boolean;
  email_found_and_valid: boolean;
  miss_reason: string | null;
  waterfall_attempts: Record<string, unknown>;
};

function linkedinPublicIdentifierFromUrl(value: unknown): string {
  return typeof value === 'string'
    ? (value.match(/linkedin\.com\/in\/([^/?#]+)/)?.[1] ?? '')
    : '';
}

const DEFAULT_COLUMNS = {
  first_name: 'first_name',
  last_name: 'last_name',
  linkedin_url: 'linkedin_url',
  domain: 'domain',
  company_name: 'company_name',
} as const;

function hasLinkedin(row: { linkedin_url?: unknown }): boolean {
  return stringOrNull(row.linkedin_url) != null;
}

function hasIdentityContext(row: PersonalEmailInput): boolean {
  if (hasLinkedin(row)) return true;
  return (
    stringOrNull(row.first_name) != null &&
    stringOrNull(row.last_name) != null &&
    (stringOrNull(row.domain) != null || stringOrNull(row.company_name) != null)
  );
}

function hasPriorPersonalEmail(
  row: PersonalEmailWaterfallRow,
  fields: readonly PersonalEmailSourceField[],
): boolean {
  return fields.some((field) => validPersonalEmail(row[field]) != null);
}

function noPriorPersonalEmail(
  row: PersonalEmailWaterfallRow,
  source: PersonalEmailSourceField,
): boolean {
  return !hasPriorPersonalEmail(row, priorPersonalEmailSourceFields(source));
}

function fullName(row: PersonalEmailInput): string {
  return [row.first_name, row.last_name]
    .map((part) => stringOrNull(part) ?? '')
    .join(' ')
    .trim();
}

function personalEmailResultFromWaterfallRow(
  row: PersonalEmailWaterfallRow,
): PersonalEmailWaterfallResult {
  for (const source of PERSONAL_EMAIL_SOURCE_FIELDS) {
    const email = validPersonalEmail(row[source]);
    if (email) {
      return {
        email,
        source,
        validated: true,
        email_found_and_valid: true,
        miss_reason: null,
        waterfall_attempts: waterfallAttempts(
          row,
          PERSONAL_EMAIL_SOURCE_FIELDS,
        ),
      };
    }
  }
  return {
    email: null,
    source: null,
    validated: false,
    email_found_and_valid: false,
    miss_reason: 'no_valid_personal_email',
    waterfall_attempts: waterfallAttempts(row, PERSONAL_EMAIL_SOURCE_FIELDS),
  };
}

function personalEmailResultField(
  row: Record<string, unknown>,
  field: keyof PersonalEmailWaterfallResult,
): string | boolean | null {
  const result = row.personal_email_result;
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const value = (result as Record<string, unknown>)[field];
  if (field === 'validated' || field === 'email_found_and_valid') {
    return value === true;
  }
  return stringOrNull(value);
}

function personalEmailResultWaterfallAttempts(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const result = row.personal_email_result;
  return result !== null && typeof result === 'object' && !Array.isArray(result)
    ? ((result as Record<string, unknown>).waterfall_attempts as Record<
        string,
        unknown
      >)
    : {};
}

function personalEmailSteps() {
  return (
    // Waterfall: personal-email providers (steps + runIf options; stop after 1 result)
    steps<PersonalEmailInput>()
      // @mermaid-node contactout out:"contactout_personal"
      .step(
        'contactout_personal',
        async (row, ctx) => {
          try {
            const contactout_personal_raw = await ctx.tools.execute({
              id: 'contactout_personal',
              tool: 'contactout_linkedin_contact_info' as any,
              input: {
                profile: row.linkedin_url ?? '',
                email_type: 'personal',
              } as any,
              description: 'contactout_personal',
            });
            return (
              validPersonalEmail(
                contactout_personal_raw.extractedValues.personal_email?.get() ??
                  null,
              ) ?? noResultWaterfallAttempt()
            );
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row) => Boolean(row.linkedin_url ?? ''),
        },
      )
      // @mermaid-node aviato out:"aviato_personal"
      .step(
        'aviato_personal',
        async (row, ctx) => {
          try {
            const aviato_personal_raw = await ctx.tools.execute({
              id: 'aviato_personal',
              tool: 'aviato_person_bulk_contact_info',
              input: {
                lookups: [{ linkedinURL: row.linkedin_url ?? '' }],
              },
              description: 'aviato_personal',
            });
            return (
              extractAviatoPersonalEmail(aviato_personal_raw) ??
              noResultWaterfallAttempt()
            );
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row) =>
            noPriorPersonalEmail(row, 'aviato_personal') && hasLinkedin(row),
        },
      )
      // @mermaid-node limadata out:"limadata_personal"
      .step(
        'limadata_personal',
        async (row, ctx) => {
          try {
            const limadata_personal_raw = await ctx.tools.execute({
              id: 'limadata_personal',
              tool: 'limadata_find_personal_email',
              input: {
                linkedin_url: row.linkedin_url ?? '',
              },
              description: 'limadata_personal',
            });
            return (
              validPersonalEmail(
                limadata_personal_raw.extractedValues.personal_email?.get() ??
                  null,
              ) ?? noResultWaterfallAttempt()
            );
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row) =>
            noPriorPersonalEmail(row, 'limadata_personal') && hasLinkedin(row),
        },
      )
      // @mermaid-node leadmagic out:"leadmagic_personal"
      .step(
        'leadmagic_personal',
        async (row, ctx) => {
          try {
            const leadmagic_personal_raw = await ctx.tools.execute({
              id: 'leadmagic_personal',
              tool: 'leadmagic_personal_email_finder',
              input: {
                profile_url: row.linkedin_url ?? '',
              },
              description: 'leadmagic_personal',
            });
            return (
              validPersonalEmail(
                leadmagic_personal_raw.extractedValues.personal_email?.get() ??
                  null,
              ) ?? noResultWaterfallAttempt()
            );
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row) =>
            noPriorPersonalEmail(row, 'leadmagic_personal') && hasLinkedin(row),
        },
      )
      // @mermaid-node wiza out:"wiza_personal"
      .step(
        'wiza_personal',
        async (row, ctx) => {
          try {
            const wiza_personal_raw = await ctx.tools.execute({
              id: 'wiza_personal',
              tool: 'wiza_reveal_person',
              input: {
                linkedin_url: row.linkedin_url ?? '',
                enrichment_level: 'partial',
                email_options: 'personal',
              },
              description: 'wiza_personal',
            });
            return (
              validPersonalEmail(
                wiza_personal_raw.extractedValues.personal_email?.get() ?? null,
              ) ?? noResultWaterfallAttempt()
            );
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row) =>
            noPriorPersonalEmail(row, 'wiza_personal') && hasLinkedin(row),
        },
      )
      // @mermaid-node icypeas out:"icypeas_personal"
      .step(
        'icypeas_personal',
        async (row, ctx) => {
          try {
            const icypeas_personal_raw = await ctx.tools.execute({
              id: 'icypeas_personal',
              tool: 'icypeas_scrape_profile',
              input: {
                url: row.linkedin_url ?? '',
              },
              description: 'icypeas_personal',
            });
            return (
              validPersonalEmail(
                icypeas_personal_raw.extractedValues.personal_email?.get() ??
                  null,
              ) ?? noResultWaterfallAttempt()
            );
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row) =>
            noPriorPersonalEmail(row, 'icypeas_personal') && hasLinkedin(row),
        },
      )
      // @mermaid-node forager out:"forager_personal"
      .step(
        'forager_personal',
        async (row, ctx) => {
          try {
            const forager_personal_raw = await ctx.tools.execute({
              id: 'forager_personal',
              tool: 'forager_person_contacts_lookup_personal_emails',
              input: {
                linkedin_public_identifier:
                  row.linkedin_public_identifier as any,
              },
              description: 'forager_personal',
            });
            return (
              validPersonalEmail(
                forager_personal_raw.extractedValues.personal_email?.get() ??
                  null,
              ) ?? noResultWaterfallAttempt()
            );
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row) =>
            noPriorPersonalEmail(row, 'forager_personal') &&
            Boolean(row.linkedin_public_identifier as any),
        },
      )
      // @mermaid-node datagma out:"datagma_personal"
      .step(
        'datagma_personal',
        async (row, ctx) => {
          const linkedin = stringOrNull(row.linkedin_url);
          const companyName = stringOrNull(row.company_name);
          const domain = stringOrNull(row.domain);
          try {
            const datagma_personal_raw = await ctx.tools.execute({
              id: 'datagma_personal',
              tool: 'datagma_enrich_person',
              input: {
                fullName: fullName(row),
                ...(linkedin ? { linkedin } : {}),
                ...(companyName ? { companyName } : {}),
                ...(domain ? { domain } : {}),
              },
              description: 'datagma_personal',
            });
            return (
              validPersonalEmail(
                datagma_personal_raw.extractedValues.personal_email?.get(),
              ) ?? noResultWaterfallAttempt()
            );
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row) =>
            noPriorPersonalEmail(row, 'datagma_personal') &&
            hasIdentityContext(row),
        },
      )
      // @mermaid-node pdl out:"pdl_personal"
      .step(
        'pdl_personal',
        async (row, ctx) => {
          const linkedin = stringOrNull(row.linkedin_url);
          const companyName = stringOrNull(row.company_name);
          const domain = stringOrNull(row.domain);
          try {
            const pdl_personal_raw = await ctx.tools.execute({
              id: 'pdl_personal',
              tool: 'peopledatalabs_enrich_contact',
              input: {
                ...(fullName(row) ? { name: fullName(row) } : {}),
                required: 'personal_emails',
                min_likelihood: 6,
                ...(linkedin ? { linkedin_url: linkedin } : {}),
                ...(companyName ? { company_name: companyName } : {}),
                ...(domain ? { domain } : {}),
              },
              description: 'pdl_personal',
            });
            return (
              validPersonalEmail(
                pdl_personal_raw.extractedValues.personal_email?.get(),
              ) ?? noResultWaterfallAttempt()
            );
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row) =>
            noPriorPersonalEmail(row, 'pdl_personal') &&
            hasIdentityContext(row),
        },
      )
      .return((row: PersonalEmailWaterfallRow) =>
        personalEmailResultFromWaterfallRow(row),
      )
  );
}

/**
 * Find personal email addresses for recruiting or personal outreach. Uses providers and extractors that target personal emails instead of default work-email resolution.
 *
 */
export const scalar = definePlay(
  'personal-email-waterfall',
  async (
    ctx,
    input: {
      first_name: string;
      last_name: string;
      linkedin_url?: string;
      domain?: string;
      company_name?: string;
    },
  ): Promise<{
    personal_email: string | null;
    email_source: string | null;
    email_validated: boolean;
    email_found_and_valid: boolean;
    miss_reason: string | null;
    waterfall_attempts: Record<string, unknown>;
  }> => {
    // Derived fields
    // @mermaid-node handle out:"linkedin_public_identifier"
    const linkedin_public_identifier = linkedinPublicIdentifierFromUrl(
      input.linkedin_url,
    );

    const playInput = {
      ...input,
      linkedin_public_identifier,
    } as PersonalEmailInput;
    // No `@mermaid-node` here: `cascade` is a SUBGRAPH in the scalar diagram,
    // and a subgraph is a region, not a node. Each attempt inside it binds to
    // its own leg above.
    const result = await ctx.runSteps<
      PersonalEmailInput,
      PersonalEmailWaterfallResult
    >(personalEmailSteps(), playInput);

    // @mermaid-node answer out:"$output"
    return {
      personal_email: result.email,
      email_source: result.source,
      email_validated: result.validated,
      email_found_and_valid: result.email_found_and_valid,
      miss_reason: result.miss_reason,
      waterfall_attempts: result.waterfall_attempts,
    };
  },
  {
    description:
      'Find a personal email address for a contact using personal-email providers.',
  },
);

export const batch = definePlay(
  'personal-email-batch',
  async (
    ctx,
    input: {
      csv: CsvInput<PersonalEmailInput>;
      columns?: ColumnMap<PersonalEmailInput>;
    },
  ): Promise<Record<string, unknown>> => {
    // @mermaid-node contacts type:"dataset" out:"contacts"
    const contacts = await ctx.csv<PersonalEmailInput>(input.csv, {
      description: 'Load contacts for personal-email resolution.',
      columns: {
        ...DEFAULT_COLUMNS,
        ...input.columns,
      },
      required: ['first_name', 'last_name'],
    });

    // @mermaid-node personal type:"dataset" out:"rows"
    const rows = await ctx
      .dataset('personal_email_rows', contacts)
      // @mermaid-node identifier out:"linkedin_public_identifier"
      .withColumn('linkedin_public_identifier', (row) =>
        linkedinPublicIdentifierFromUrl(row.linkedin_url),
      )
      // @mermaid-node waterfall out:"personal_email_result"
      .withColumn('personal_email_result', personalEmailSteps())
      .withColumn('personal_email', (row) =>
        personalEmailResultField(row, 'email'),
      )
      .withColumn('email_source', (row) =>
        personalEmailResultField(row, 'source'),
      )
      .withColumn('email_validated', (row) =>
        personalEmailResultField(row, 'validated'),
      )
      .withColumn('email_found_and_valid', (row) =>
        personalEmailResultField(row, 'email_found_and_valid'),
      )
      .withColumn('miss_reason', (row) =>
        personalEmailResultField(row, 'miss_reason'),
      )
      .withColumn('waterfall_attempts', (row) =>
        personalEmailResultWaterfallAttempts(row),
      )
      .run({
        description: 'Resolve a personal email for each contact row.',
      });

    // @mermaid-node out out:"$output"
    return { rows };
  },
  {
    description: 'Resolve personal emails for a CSV of contacts.',
  },
);

export default scalar;
