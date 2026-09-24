/** @mermaid scalar
 * flowchart TD
 * profileUrl["Normalize the profile URL"] --> cascade
 * subgraph cascade["Try each source until one returns a work email"]
 *   prospeo["Prospeo"] --> native["Deepline directory"]
 *   native --> findymail["Findymail"]
 *   findymail --> lusha["Lusha"]
 *   lusha --> contactout["ContactOut"]
 *   contactout --> forager["Forager"]
 *   forager --> leadmagic["LeadMagic"]
 *   leadmagic --> pdl["PDL · work email required"]
 * end
 * cascade --> answer["Return the email and where it came from"]
 */
/** @mermaid batch
 * flowchart TD
 * profiles[("Profile rows")] --> emails[("Email rows")]
 * emails --> loop
 * subgraph loop["For each profile"]
 *   normalize["Normalize the profile URL"] --> waterfall["Cascade providers for a work email"]
 * end
 * loop --> out["Return enriched rows"]
 */
import { definePlay, isProviderUnavailable, steps } from 'deepline';
import type { ColumnMap, CsvInput } from 'deepline';
import {
  noResultWaterfallAttempt,
  normalizedEmailValidationStatus,
  unavailableWaterfallAttempt,
  waterfallAttempts,
} from './waterfall-attempts';

type PersonLinkedInEmailInput = Record<string, unknown> & {
  linkedin_url: string;
};

type PersonLinkedInEmailWaterfallRow = PersonLinkedInEmailInput & {
  prospeo_verified_email?: unknown;
  native_contact?: unknown;
  findymail_business_profile_email?: unknown;
  lusha_linkedin_email?: unknown;
  contactout_work_email?: unknown;
  forager_work_email?: unknown;
  leadmagic_social_email?: unknown;
  pdl_work_email?: unknown;
};

type PersonLinkedInEmailWaterfallResult = {
  email: string | null;
  source: string | null;
  validated: boolean;
  email_found_and_valid: boolean;
  miss_reason: string | null;
  waterfall_attempts: Record<string, unknown>;
};

const DEFAULT_COLUMNS = {
  linkedin_url: 'linkedin_url',
} as const;

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeLinkedInProfileUrl(value: unknown): string | null {
  const trimmed = stringOrNull(value);
  if (!trimmed) return null;
  const match = trimmed.match(
    /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#]+)\/?/i,
  );
  if (!match?.[2]) return null;
  return `https://www.linkedin.com/in/${match[2]}`;
}

function isLikelyEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return false;
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..'))
    return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..'))
    return false;
  return true;
}

function validEmailCandidate(candidate: unknown): string | null {
  const email = stringOrNull(candidate);
  return email && isLikelyEmail(email) ? email : null;
}

const PERSON_LINKEDIN_EMAIL_SOURCE_FIELDS = [
  'prospeo_verified_email',
  'native_contact',
  'findymail_business_profile_email',
  'lusha_linkedin_email',
  'contactout_work_email',
  'forager_work_email',
  'leadmagic_social_email',
  'pdl_work_email',
] as const;

function emailResultFromWaterfallRow(
  row: PersonLinkedInEmailWaterfallRow,
): PersonLinkedInEmailWaterfallResult {
  for (const source of PERSON_LINKEDIN_EMAIL_SOURCE_FIELDS) {
    const email = validEmailCandidate(row[source]);
    if (email) {
      return {
        email,
        source,
        validated: true,
        email_found_and_valid: true,
        miss_reason: null,
        waterfall_attempts: waterfallAttempts(
          row,
          PERSON_LINKEDIN_EMAIL_SOURCE_FIELDS,
        ),
      };
    }
  }
  return {
    email: null,
    source: null,
    validated: false,
    email_found_and_valid: false,
    miss_reason: 'no_valid_work_email',
    waterfall_attempts: waterfallAttempts(
      row,
      PERSON_LINKEDIN_EMAIL_SOURCE_FIELDS,
    ),
  };
}

// A finder tool returned a candidate, but the zerobounce_validate call
// that ran (and billed) afterward rejected it. Distinct from a bare `null`
// (no candidate at all, or step skipped) so waterfall_attempts shows what a
// charged validation call actually returned.
function emailValidationRejected(
  candidate: string,
  status: string | undefined,
): Record<string, unknown> {
  return {
    outcome: 'validation_rejected',
    candidate_email: candidate,
    validation_status: status || null,
  };
}

function noPriorWorkEmail(
  row: PersonLinkedInEmailWaterfallRow,
  fields: readonly (typeof PERSON_LINKEDIN_EMAIL_SOURCE_FIELDS)[number][],
): boolean {
  return fields.every((field) => validEmailCandidate(row[field]) === null);
}

function emailResultField(
  row: Record<string, unknown>,
  field: keyof PersonLinkedInEmailWaterfallResult,
): string | boolean | null {
  const result = row.email_result;
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const value = (result as Record<string, unknown>)[field];
  if (field === 'validated' || field === 'email_found_and_valid') {
    return value === true;
  }
  return stringOrNull(value);
}

function emailResultWaterfallAttempts(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const result = row.email_result;
  return result !== null && typeof result === 'object' && !Array.isArray(result)
    ? ((result as Record<string, unknown>).waterfall_attempts as Record<
        string,
        unknown
      >)
    : {};
}

function extractedValue(
  values: unknown,
  key: string,
): { get(): unknown } | undefined {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    return undefined;
  }
  const value = (values as Record<string, unknown>)[key];
  if (value === null || typeof value !== 'object' || !('get' in value)) {
    return undefined;
  }
  const getter = (value as { get?: unknown }).get;
  return typeof getter === 'function'
    ? { get: getter as () => unknown }
    : undefined;
}

function personLinkedInToEmailSteps() {
  return (
    // Waterfall: LinkedIn profile to work-email providers (steps + runIf options; stop after 1 result)
    steps<PersonLinkedInEmailInput>()
      // @mermaid-node prospeo out:"prospeo_verified_email"
      .step(
        'prospeo_verified_email',
        async (row, ctx) => {
          try {
            const prospeo_verified_email_raw = await ctx.tools.execute({
              id: 'prospeo_verified_email',
              tool: 'prospeo_enrich_person',
              input: {
                linkedin_url: row.linkedin_url ?? '',
                only_verified_email: true,
              },
              description: 'prospeo_verified_email',
            });
            const candidate = stringOrNull(
              prospeo_verified_email_raw.extractedValues.email?.get(),
            );
            if (!candidate || !isLikelyEmail(candidate))
              return noResultWaterfallAttempt();
            const validation = await ctx.tools.execute({
              id: 'prospeo_verified_email_validation',
              tool: 'zerobounce_validate',
              description: 'prospeo_verified_email_validation',
              input: { email: candidate },
            });
            const status = normalizedEmailValidationStatus(
              validation.extractedValues.email_status?.get(),
            );
            if (status !== 'valid')
              return emailValidationRejected(candidate, status);
            return (
              stringOrNull(validation.extractedValues.email?.get()) ?? candidate
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
      // @mermaid-node native out:"native_contact"
      .step(
        'native_contact',
        async (row, ctx) => {
          try {
            const native_contact_raw = await ctx.tools.execute({
              id: 'native_contact',
              tool: 'deepline_native_enrich_contact',
              input: {
                linkedin: row.linkedin_url ?? '',
                include_phones: false,
              },
              description: 'native_contact',
            });
            return native_contact_raw.extractedValues.email?.get() ?? null;
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: () => false,
        },
      )
      // @mermaid-node findymail out:"findymail_business_profile_email"
      .step(
        'findymail_business_profile_email',
        async (row, ctx) => {
          try {
            const findymail_business_profile_email_raw =
              await ctx.tools.execute({
                id: 'findymail_business_profile_email',
                tool: 'findymail_find_from_business_profile',
                input: {
                  linkedin_url: row.linkedin_url ?? '',
                },
                description: 'findymail_business_profile_email',
              });
            const candidate = stringOrNull(
              findymail_business_profile_email_raw.extractedValues.email?.get(),
            );
            if (!candidate || !isLikelyEmail(candidate))
              return noResultWaterfallAttempt();
            const validation = await ctx.tools.execute({
              id: 'findymail_business_profile_email_validation',
              tool: 'zerobounce_validate',
              description: 'findymail_business_profile_email_validation',
              input: { email: candidate },
            });
            const status = normalizedEmailValidationStatus(
              validation.extractedValues.email_status?.get(),
            );
            if (status !== 'valid')
              return emailValidationRejected(candidate, status);
            return (
              stringOrNull(validation.extractedValues.email?.get()) ?? candidate
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
            noPriorWorkEmail(row, [
              'prospeo_verified_email',
              'native_contact',
            ]) && Boolean(row.linkedin_url ?? ''),
        },
      )
      // @mermaid-node lusha out:"lusha_linkedin_email"
      .step(
        'lusha_linkedin_email',
        async (row, ctx) => {
          try {
            const lusha_linkedin_email_raw = await ctx.tools.execute({
              id: 'lusha_linkedin_email',
              tool: 'lusha_enrich_person',
              input: {
                linkedin_url: row.linkedin_url ?? '',
                reveal_emails: true,
                reveal_phones: false,
              },
              description: 'lusha_linkedin_email',
            });
            return (
              lusha_linkedin_email_raw.extractedValues.email?.get() ?? null
            );
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: () => false,
        },
      )
      // @mermaid-node contactout out:"contactout_work_email"
      .step(
        'contactout_work_email',
        async (row, ctx) => {
          try {
            const contactout_work_email_raw = await ctx.tools.execute({
              id: 'contactout_work_email',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ContactOut is supported by the prebuilt analyzer before the SDK tool union knows this action.
              tool: 'contactout_linkedin_contact_info' as any,
              input: {
                profile: row.linkedin_url ?? '',
                email_type: 'work',
                include_phone: false,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Keep the direct ctx.tools.execute request literal for prebuilt static analysis.
              } as any,
              description: 'contactout_work_email',
            });
            const candidate = stringOrNull(
              contactout_work_email_raw.extractedValues.email?.get() ??
                extractedValue(
                  contactout_work_email_raw.extractedValues,
                  'work_email',
                )?.get(),
            );
            if (!candidate || !isLikelyEmail(candidate))
              return noResultWaterfallAttempt();
            const validation = await ctx.tools.execute({
              id: 'contactout_work_email_validation',
              tool: 'zerobounce_validate',
              description: 'contactout_work_email_validation',
              input: { email: candidate },
            });
            const status = normalizedEmailValidationStatus(
              validation.extractedValues.email_status?.get(),
            );
            if (status !== 'valid')
              return emailValidationRejected(candidate, status);
            return (
              stringOrNull(validation.extractedValues.email?.get()) ?? candidate
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
            noPriorWorkEmail(row, [
              'prospeo_verified_email',
              'native_contact',
              'findymail_business_profile_email',
              'lusha_linkedin_email',
            ]) && Boolean(row.linkedin_url ?? ''),
        },
      )
      // @mermaid-node forager out:"forager_work_email"
      .step(
        'forager_work_email',
        async (row, ctx) => {
          try {
            const forager_work_email_raw = await ctx.tools.execute({
              id: 'forager_work_email',
              tool: 'forager_person_contacts_lookup_work_emails',
              input: {
                linkedin_public_identifier: row.linkedin_url ?? '',
              },
              description: 'forager_work_email',
            });
            const candidate = stringOrNull(
              forager_work_email_raw.extractedValues.email?.get(),
            );
            if (!candidate || !isLikelyEmail(candidate))
              return noResultWaterfallAttempt();
            const validation = await ctx.tools.execute({
              id: 'forager_work_email_validation',
              tool: 'zerobounce_validate',
              description: 'forager_work_email_validation',
              input: { email: candidate },
            });
            const status = normalizedEmailValidationStatus(
              validation.extractedValues.email_status?.get(),
            );
            if (status !== 'valid')
              return emailValidationRejected(candidate, status);
            return (
              stringOrNull(validation.extractedValues.email?.get()) ?? candidate
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
            noPriorWorkEmail(row, [
              'prospeo_verified_email',
              'native_contact',
              'findymail_business_profile_email',
              'lusha_linkedin_email',
              'contactout_work_email',
            ]) && Boolean(row.linkedin_url ?? ''),
        },
      )
      // @mermaid-node leadmagic out:"leadmagic_social_email"
      .step(
        'leadmagic_social_email',
        async (row, ctx) => {
          try {
            const leadmagic_social_email_raw = await ctx.tools.execute({
              id: 'leadmagic_social_email',
              tool: 'leadmagic_b2b_social_email',
              input: {
                profile_url: row.linkedin_url ?? '',
              },
              description: 'leadmagic_social_email',
            });
            const candidate = stringOrNull(
              leadmagic_social_email_raw.extractedValues.email?.get(),
            );
            if (!candidate || !isLikelyEmail(candidate))
              return noResultWaterfallAttempt();
            const validation = await ctx.tools.execute({
              id: 'leadmagic_social_email_validation',
              tool: 'zerobounce_validate',
              description: 'leadmagic_social_email_validation',
              input: { email: candidate },
            });
            const status = normalizedEmailValidationStatus(
              validation.extractedValues.email_status?.get(),
            );
            if (status !== 'valid')
              return emailValidationRejected(candidate, status);
            return (
              stringOrNull(validation.extractedValues.email?.get()) ?? candidate
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
            noPriorWorkEmail(row, [
              'prospeo_verified_email',
              'native_contact',
              'findymail_business_profile_email',
              'lusha_linkedin_email',
              'contactout_work_email',
              'forager_work_email',
            ]) && Boolean(row.linkedin_url ?? ''),
        },
      )
      // @mermaid-node pdl out:"pdl_work_email"
      .step(
        'pdl_work_email',
        async (row, ctx) => {
          try {
            const pdl_work_email_raw = await ctx.tools.execute({
              id: 'pdl_work_email',
              tool: 'peopledatalabs_enrich_contact',
              input: {
                linkedin_url: row.linkedin_url ?? '',
                required: 'work_email',
                min_likelihood: 6,
              },
              description:
                'Find a work email with PDL; require work_email for a billable match.',
            });
            const candidate = stringOrNull(
              pdl_work_email_raw.extractedValues.email?.get(),
            );
            if (!candidate || !isLikelyEmail(candidate))
              return noResultWaterfallAttempt();
            const validation = await ctx.tools.execute({
              id: 'pdl_work_email_validation',
              tool: 'zerobounce_validate',
              description: 'Validate the work email returned by PDL.',
              input: { email: candidate },
            });
            const status = normalizedEmailValidationStatus(
              validation.extractedValues.email_status?.get(),
            );
            if (status !== 'valid')
              return emailValidationRejected(candidate, status);
            return (
              stringOrNull(validation.extractedValues.email?.get()) ?? candidate
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
            noPriorWorkEmail(row, [
              'prospeo_verified_email',
              'native_contact',
              'findymail_business_profile_email',
              'lusha_linkedin_email',
              'contactout_work_email',
              'forager_work_email',
              'leadmagic_social_email',
            ]) && Boolean(row.linkedin_url ?? ''),
        },
      )
      .return((row: PersonLinkedInEmailWaterfallRow) =>
        emailResultFromWaterfallRow(row),
      )
  );
}

/**
 * Resolve contact email from a standard person LinkedIn URL using LinkedIn-native enrichment providers. Waterfall order: prospeo -> deepline_native -> lusha -> contactout -> forager -> leadmagic -> PDL (work email required).
 *
 */
export const scalar = definePlay(
  'person-linkedin-to-email-waterfall',
  async (
    ctx,
    input: { linkedin_url: string },
  ): Promise<{
    email: string | null;
    email_source: string | null;
    email_validated: boolean;
    email_found_and_valid: boolean;
    miss_reason: string | null;
    waterfall_attempts: Record<string, unknown>;
  }> => {
    // @mermaid-node profileUrl out:"linkedin_url"
    const linkedin_url = normalizeLinkedInProfileUrl(input.linkedin_url) ?? '';

    const playInput = {
      ...input,
      linkedin_url,
    } as PersonLinkedInEmailInput;
    // No `@mermaid-node` here: `cascade` is a SUBGRAPH in the scalar diagram,
    // and a subgraph is a region, not a node. Each attempt inside it binds to
    // its own leg above.
    const result = await ctx.runSteps<
      PersonLinkedInEmailInput,
      PersonLinkedInEmailWaterfallResult
    >(personLinkedInToEmailSteps(), playInput);

    // @mermaid-node answer out:"$output"
    return {
      email: result.email,
      email_source: result.source,
      email_validated: result.validated,
      email_found_and_valid: result.email_found_and_valid,
      miss_reason: result.miss_reason,
      waterfall_attempts: result.waterfall_attempts,
    };
  },
  { description: 'Turn a LinkedIn profile URL into a verified work email.' },
);

export const batch = definePlay(
  'person-linkedin-to-email-batch',
  async (
    ctx,
    input: {
      csv: CsvInput<PersonLinkedInEmailInput>;
      columns?: ColumnMap<PersonLinkedInEmailInput>;
    },
  ): Promise<Record<string, unknown>> => {
    // @mermaid-node profiles type:"dataset" out:"profiles"
    const profiles = await ctx.csv<PersonLinkedInEmailInput>(input.csv, {
      description: 'Load LinkedIn profile rows for work-email resolution.',
      columns: {
        ...DEFAULT_COLUMNS,
        ...input.columns,
      },
      required: ['linkedin_url'],
    });

    // @mermaid-node emails type:"dataset" out:"rows"
    const rows = await ctx
      .dataset('linkedin_email_rows', profiles)
      // @mermaid-node normalize out:"linkedin_url"
      .withColumn(
        'linkedin_url',
        (row) => normalizeLinkedInProfileUrl(row.linkedin_url) ?? '',
      )
      // @mermaid-node waterfall out:"email_result"
      .withColumn('email_result', personLinkedInToEmailSteps())
      .withColumn('email', (row) => emailResultField(row, 'email'))
      .withColumn('email_source', (row) => emailResultField(row, 'source'))
      .withColumn('email_validated', (row) =>
        emailResultField(row, 'validated'),
      )
      .withColumn('email_found_and_valid', (row) =>
        emailResultField(row, 'email_found_and_valid'),
      )
      .withColumn('miss_reason', (row) => emailResultField(row, 'miss_reason'))
      .withColumn('waterfall_attempts', (row) =>
        emailResultWaterfallAttempts(row),
      )
      .run({
        description: 'Resolve a verified work email for each LinkedIn profile.',
      });

    // @mermaid-node out out:"$output"
    return { rows };
  },
  {
    description:
      'Resolve verified work emails for a CSV of LinkedIn profile URLs.',
  },
);

export default scalar;
