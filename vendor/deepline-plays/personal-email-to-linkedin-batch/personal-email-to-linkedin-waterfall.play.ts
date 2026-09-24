/** @mermaid scalar
 * flowchart TD
 * address["Normalize the address"] --> cascade
 * subgraph cascade["Cascade until one matches a profile"]
 *   native["Deepline reverse lookup"] --> forager["Forager reverse lookup"] --> findymail["Findymail reverse lookup"] --> pdl["People Data Labs"]
 * end
 * cascade --> answer["Return the profile and where it came from"]
 * class forager sketch
 */
/** @mermaid batch
 * flowchart TD
 * emails[("Personal email rows")] --> matched[("Match rows")]
 * matched --> loop
 * subgraph loop["For each email"]
 *   normalize["Normalize the address"] --> waterfall["Cascade providers for a profile"]
 * end
 * loop --> out["Return enriched rows"]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { definePlay, isProviderUnavailable, steps } from 'deepline';
import type { ColumnMap, CsvInput } from 'deepline';
import {
  unavailableWaterfallAttempt,
  waterfallAttempts,
} from './waterfall-attempts';

/**
 * Reverse-resolve a person's LinkedIn profile (plus name, company, and title) from a
 * bare personal email such as a Gmail or GitHub signup address, where no name or company
 * is known up front. This is the inverse of the work-email plays: the input is a personal
 * email and the most useful output is the LinkedIn profile, which on these lists is both
 * more recoverable and more useful for social selling than a work email.
 *
 * Two realities shape the waterfall:
 *   1. Coverage is a property of the input, not the provider. Bare personal emails resolve
 *      at roughly 25-40%; the misses are people no provider has in its identity graph, so
 *      escalating providers helps only at the margin. The waterfall stops at the first real
 *      match and charges per hit, so unresolved rows cost nothing extra.
 *   2. Gmail ignores dots and +tags in the local part (an.dy.graham@gmail.com is the same
 *      inbox as andygraham@gmail.com), but providers frequently miss the dotted form and hit
 *      on the canonical one. We normalize first, which also collapses duplicate signups.
 *
 * Provider order, validated on real signup data (cheapest/highest-coverage first):
 *   1. deepline_native_enrich_contact  free      internal cache; best coverage. Returns a
 *                                                 null person object on a miss, not an error.
 *   2. forager_person_detail_reverse_lookup_by_email   reverse lookup; ties native on coverage.
 *   3. findymail_reverse_email_lookup                  thinner coverage, richest single profile.
 *   4. peopledatalabs_enrich_contact                   widest identity graph fallback.
 *
 * crustdata and datagma are deliberately excluded: they reject webmail by design (they enrich
 * FROM a work email, not TO one).
 */

type PersonalEmailRow = Record<string, unknown> & {
  personal_email: string;
  normalized_email: string;
};

type PersonalEmailToLinkedInInput = Record<string, unknown> & {
  personal_email: string;
};

const DEFAULT_COLUMNS = {
  personal_email: 'personal_email',
} as const;

type Resolved = {
  linkedin_url: string | null;
  name: string | null;
  company: string | null;
  title: string | null;
  source: string | null;
};

const PERSONAL_EMAIL_TO_LINKEDIN_ATTEMPT_FIELDS = [
  'native',
  'forager',
  'findymail',
  'pdl',
] as const;

type PersonalEmailToLinkedInResult = Resolved & {
  waterfall_attempts: Record<string, unknown>;
};

// Gmail/Googlemail canonicalization: strip +tags and dots from the local part. Other
// providers (and other domains) treat dots as significant, so only touch gmail addresses.
function normalizeEmail(raw: string): string {
  const email = String(raw ?? '')
    .trim()
    .toLowerCase();
  let at = -1;
  for (let index = email.length - 1; index >= 0; index -= 1) {
    if (email[index] === '@') {
      at = index;
      break;
    }
  }
  if (at < 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const canon = local.split('+')[0]!.replace(/\./g, '');
    return `${canon}@${domain}`;
  }
  return email;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function rawRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function valuesAtPath(value: unknown, parts: string[]): unknown[] {
  if (parts.length === 0) return [value];
  const [part, ...rest] = parts;
  if (!part) return [];
  if (part.endsWith('[*]')) {
    const key = part.slice(0, -3);
    const arrayValue = rawRecord(value)?.[key];
    if (!Array.isArray(arrayValue)) return [];
    return arrayValue.flatMap((item) => valuesAtPath(item, rest));
  }
  const next = rawRecord(value)?.[part];
  return next === undefined ? [] : valuesAtPath(next, rest);
}

function rawString(
  execution: { toolResponse?: { raw?: unknown } },
  ...paths: string[]
): string | null {
  for (const path of paths) {
    for (const value of valuesAtPath(
      execution.toolResponse?.raw,
      path.split('.'),
    )) {
      const hit = str(value);
      if (hit) return hit;
    }
  }
  return null;
}

function normalizeLinkedInProfileUrl(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw
    : raw.includes('linkedin.com/')
      ? `https://${raw.replace(/^www\./i, '')}`
      : `https://www.linkedin.com/in/${raw.replace(/^\/+/, '')}`;
  const match = withScheme.match(
    /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/([a-z0-9][a-z0-9_-]{0,99})\/?(?:[?#].*)?$/i,
  );
  if (!match?.[2]) return null;
  return `https://www.linkedin.com/in/${match[2]}`;
}

// A row "hit" requires a real LinkedIn URL, the whole point of this play. A provider that
// returns only a name with no profile is treated as a miss so the waterfall keeps escalating.
function isHit(r: unknown): r is Resolved {
  return (
    normalizeLinkedInProfileUrl((r as Resolved | null)?.linkedin_url) != null
  );
}

// Earlier step results are accumulated onto the row under their step alias. They are added
// dynamically, so read them through a loose accessor rather than widening PersonalEmailRow.
function prior(row: PersonalEmailRow, alias: string): unknown {
  return (row as Record<string, unknown>)[alias];
}

function personalEmailToLinkedInSteps() {
  return (
    steps<PersonalEmailRow>()
      // 1. deepline_native: free internal cache, best coverage. On a miss it returns
      //    output.person with all-null fields, so gate downstream steps on a real linkedin_url.
      // @mermaid-node native out:"native"
      .step('native', async (row: PersonalEmailRow, ctx) => {
        try {
          const raw = await ctx.tools.execute({
            id: 'native',
            tool: 'deepline_native_enrich_contact',
            input: { email: row.normalized_email },
            description: 'native reverse lookup',
          });
          return {
            linkedin_url: normalizeLinkedInProfileUrl(
              raw.extractedValues.linkedin?.get(),
            ),
            name: str(raw.extractedValues.full_name?.get()),
            company: rawString(
              raw,
              'result.data.output.person.company_name',
              'data.output.person.company_name',
              'data.company_name',
              'data.organization_name',
              'results[*].company_name',
              'results[*].organization_name',
              'company_name',
              'organization_name',
            ),
            title: str(raw.extractedValues.title?.get()),
            source: 'native',
          };
        } catch (error: unknown) {
          if (isProviderUnavailable(error)) {
            return unavailableWaterfallAttempt(error);
          }
          throw error;
        }
      })
      // 2. forager reverse lookup, ties native on coverage.
      .step(
        'forager',
        async (row: PersonalEmailRow, ctx) => {
          try {
            const raw = await ctx.tools.execute({
              id: 'forager',
              tool: 'forager_person_detail_reverse_lookup_by_email',
              input: { email: row.normalized_email },
              description: 'forager reverse lookup',
            });
            return {
              linkedin_url: normalizeLinkedInProfileUrl(
                raw.extractedValues.linkedin?.get(),
              ),
              name: str(raw.extractedValues.full_name?.get()),
              company: rawString(
                raw,
                'result.data.current_employer',
                'result.data.roles[*].organization_name',
              ),
              title: str(raw.extractedValues.title?.get()),
              source: 'forager',
            };
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PersonalEmailRow) => !isHit(prior(row, 'native')),
        },
      )
      // 3. findymail: thinner coverage, richest single profile. Returns the LinkedIn slug
      //    in `username`, so reconstruct the full URL when only the slug is present.
      // @mermaid-node findymail out:"findymail"
      .step(
        'findymail',
        async (row: PersonalEmailRow, ctx) => {
          try {
            const raw = await ctx.tools.execute({
              id: 'findymail',
              tool: 'findymail_reverse_email_lookup',
              input: { email: row.normalized_email, with_profile: true },
              description: 'findymail reverse lookup',
            });
            return {
              linkedin_url: normalizeLinkedInProfileUrl(
                raw.extractedValues.linkedin?.get(),
              ),
              name: str(raw.extractedValues.full_name?.get()),
              company: str(raw.extractedValues.company_name?.get()),
              title: str(raw.extractedValues.title?.get()),
              source: 'findymail',
            };
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PersonalEmailRow) =>
            !isHit(prior(row, 'native')) && !isHit(prior(row, 'forager')),
        },
      )
      // 4. peopledatalabs: widest identity graph, final fallback.
      // @mermaid-node pdl out:"pdl"
      .step(
        'pdl',
        async (row: PersonalEmailRow, ctx) => {
          let raw;
          try {
            raw = await ctx.tools.execute({
              id: 'pdl',
              tool: 'peopledatalabs_enrich_contact',
              input: { email: row.normalized_email },
              description: 'pdl reverse lookup',
            });
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
          return {
            linkedin_url: normalizeLinkedInProfileUrl(
              raw.extractedValues.linkedin?.get(),
            ),
            name: str(raw.extractedValues.full_name?.get()),
            company: rawString(
              raw,
              'data.job_company_name',
              'job_company_name',
              'data.company_name',
              'company_name',
              'data.experience[*].company.name',
              'experience[*].company.name',
            ),
            title: str(raw.extractedValues.title?.get()),
            source: 'pdl',
          };
        },
        {
          runIf: (row: PersonalEmailRow) =>
            !isHit(prior(row, 'native')) &&
            !isHit(prior(row, 'forager')) &&
            !isHit(prior(row, 'findymail')),
        },
      )
      .return((row: PersonalEmailRow): PersonalEmailToLinkedInResult => {
        const best =
          [
            prior(row, 'native'),
            prior(row, 'forager'),
            prior(row, 'findymail'),
            prior(row, 'pdl'),
          ].find(isHit) ?? null;
        return {
          linkedin_url: best?.linkedin_url ?? null,
          name: best?.name ?? null,
          company: best?.company ?? null,
          title: best?.title ?? null,
          source: best?.source ?? null,
          waterfall_attempts: waterfallAttempts(
            row,
            PERSONAL_EMAIL_TO_LINKEDIN_ATTEMPT_FIELDS,
          ),
        };
      })
  );
}

export const scalar = definePlay(
  'personal-email-to-linkedin-waterfall',
  async (
    ctx,
    input: {
      personal_email: string;
    },
  ): Promise<{
    personal_email: string;
    normalized_email: string;
    linkedin_url: string | null;
    linkedin_source: string | null;
    name: string | null;
    company: string | null;
    title: string | null;
    linkedin_profile_found: boolean;
    miss_reason: string | null;
    waterfall_attempts: Record<string, unknown>;
  }> => {
    // @mermaid-node address out:"normalized_email"
    const normalized_email = normalizeEmail(input.personal_email);

    const playInput = {
      ...input,
      normalized_email,
    } as PersonalEmailRow;

    const result = await ctx.runSteps<
      PersonalEmailRow,
      PersonalEmailToLinkedInResult
    >(personalEmailToLinkedInSteps(), playInput);

    // @mermaid-node answer out:"$output"
    return {
      personal_email: input.personal_email,
      normalized_email,
      linkedin_url: result.linkedin_url,
      linkedin_source: result.source,
      name: result.name,
      company: result.company,
      title: result.title,
      linkedin_profile_found: result.linkedin_url !== null,
      miss_reason: result.linkedin_url ? null : 'no_linkedin_profile',
      waterfall_attempts: result.waterfall_attempts,
    };
  },
  {
    description:
      'Resolve a personal email address to the matching LinkedIn profile and identity context.',
  },
);

export const batch = definePlay(
  'personal-email-to-linkedin-batch',
  async (
    ctx,
    input: {
      csv: CsvInput<PersonalEmailToLinkedInInput>;
      columns?: ColumnMap<PersonalEmailToLinkedInInput>;
    },
  ): Promise<Record<string, unknown>> => {
    // @mermaid-node emails type:"dataset" out:"emails"
    const emails = await ctx.csv<PersonalEmailToLinkedInInput>(input.csv, {
      description: 'Load personal email rows for LinkedIn profile resolution.',
      columns: {
        ...DEFAULT_COLUMNS,
        ...input.columns,
      },
      required: ['personal_email'],
    });

    // @mermaid-node matched type:"dataset" out:"rows"
    const rows = await ctx
      .dataset('rows', emails)
      // @mermaid-node normalize out:"normalized_email"
      .withColumn('normalized_email', (row) =>
        normalizeEmail(row.personal_email),
      )
      // @mermaid-node waterfall out:"linkedin_result"
      .withColumn('linkedin_result', personalEmailToLinkedInSteps())
      .withColumn(
        'linkedin_url',
        (row) => (row.linkedin_result as any)?.linkedin_url ?? null,
      )
      .withColumn(
        'linkedin_source',
        (row) => (row.linkedin_result as any)?.source ?? null,
      )
      .withColumn('name', (row) => (row.linkedin_result as any)?.name ?? null)
      .withColumn(
        'company',
        (row) => (row.linkedin_result as any)?.company ?? null,
      )
      .withColumn('title', (row) => (row.linkedin_result as any)?.title ?? null)
      .withColumn(
        'linkedin_profile_found',
        (row) => (row.linkedin_result as any)?.linkedin_url != null,
      )
      .withColumn('miss_reason', (row) =>
        (row.linkedin_result as any)?.linkedin_url
          ? null
          : 'no_linkedin_profile',
      )
      .withColumn(
        'waterfall_attempts',
        (row) => (row.linkedin_result as any)?.waterfall_attempts ?? {},
      )
      .run({
        description: 'Resolve LinkedIn profiles for each personal email row.',
      });

    // @mermaid-node out out:"$output"
    return { rows };
  },
  {
    description:
      'Resolve LinkedIn profiles for a CSV of personal email addresses.',
  },
);

export default scalar;
