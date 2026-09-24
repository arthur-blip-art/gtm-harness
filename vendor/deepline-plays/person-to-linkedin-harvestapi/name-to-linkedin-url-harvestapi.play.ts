/** @mermaid scalar
 * flowchart TD
 * searchAnchor["Build the company search anchor"] --> cascade["Cascade providers for a profile URL"]
 */
/** @mermaid batch
 * flowchart TD
 * people[("People rows")] --> profiles[("Profile rows")]
 * profiles --> loop
 * subgraph loop["For each person"]
 *   anchor["Build the company search anchor"] --> waterfall["Cascade providers for a profile URL"]
 * end
 * loop --> out["Return enriched rows"]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { definePlay, isProviderUnavailable, steps } from 'deepline';
import type { ColumnMap, CsvInput } from 'deepline';
import {
  noResultWaterfallAttempt,
  unavailableWaterfallAttempt,
  waterfallAttempts,
} from './waterfall-attempts';

type LinkedinWaterfallResult = {
  url: string | null;
  source: string | null;
  waterfall_attempts: Record<string, unknown>;
};

// The three provider stages run inside the nested `candidate` step, so they
// live on that sub-row and never on the outer row. Projecting them off the
// outer row yields `null` for every stage on every run — which the attempt
// contract reads as "skipped by runIf, never called" — even for the stage
// that actually won. Keep the two levels separate and merge them at the end.
const CANDIDATE_ATTEMPT_FIELDS = [
  'primary',
  'name_only',
  'email_lookup',
] as const;

const OUTER_ATTEMPT_FIELDS = ['validate', 'fallback'] as const;

/**
 * Attempt map for the nested candidate waterfall.
 *
 * The nested step already projects its own stages correctly, so reuse that map
 * rather than re-deriving it. When the candidate step itself was skipped there
 * is no sub-row to read, so emit the stage keys as bare `null` to keep the
 * public attempt shape stable across runs.
 */
function candidateWaterfallAttempts(
  candidate: LinkedinWaterfallResult | undefined,
): Record<string, unknown> {
  const attempts = candidate?.waterfall_attempts;
  if (attempts && typeof attempts === 'object' && !Array.isArray(attempts)) {
    return waterfallAttempts(
      attempts as Record<string, unknown>,
      CANDIDATE_ATTEMPT_FIELDS,
    );
  }
  return waterfallAttempts({}, CANDIDATE_ATTEMPT_FIELDS);
}

type PersonToLinkedInInput = Record<string, unknown> & {
  first_name: string;
  last_name: string;
  domain?: string;
  company_name?: string;
  email?: string;
};

const DEFAULT_COLUMNS = {
  first_name: 'first_name',
  last_name: 'last_name',
  domain: 'domain',
  company_name: 'company_name',
  email: 'email',
} as const;

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeLinkedInProfileUrl(value: unknown): string | null {
  const raw = stringOrNull(value);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw
    : raw.includes('linkedin.com/')
      ? `https://${raw.replace(/^www\./i, '')}`
      : `https://www.linkedin.com/in/${raw.replace(/^\/+/, '')}`;
  const match = withScheme.match(
    /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#]+)\/?/i,
  );
  if (!match?.[2]) return null;
  return `https://www.linkedin.com/in/${match[2]}`;
}

function waterfallMiss(value: unknown): boolean {
  return normalizeLinkedInProfileUrl(value) === null;
}

function normalizeNamePart(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function namePartMatches(expected: unknown, actual: unknown): boolean {
  const expectedPart = normalizeNamePart(expected);
  const actualPart = normalizeNamePart(actual);
  return Boolean(expectedPart && actualPart && expectedPart === actualPart);
}

// The candidate/name-validation step found and billably checked a URL, but
// rejected it. Distinct from a bare `null` (no candidate, or step skipped)
// so waterfall_attempts shows what the validation call actually returned.
function nameValidationRejected(
  candidateUrl: string | null,
  reason: string,
): Record<string, unknown> {
  return {
    outcome: 'validation_rejected',
    candidate_url: candidateUrl,
    reject_reason: reason,
  };
}

function validateLinkedinCandidate(
  row: LinkedinWorkingRow,
  candidateUrl: string,
  profileResponse: any,
): string | Record<string, unknown> {
  const normalizedUrl = normalizeLinkedInProfileUrl(candidateUrl);
  if (!normalizedUrl) {
    return nameValidationRejected(candidateUrl, 'malformed_candidate_url');
  }
  const raw =
    (profileResponse.toolResponse?.rawV2 as any) ??
    (profileResponse.toolResponse?.raw as any);
  const profile = raw?.element ?? raw?.data?.element ?? raw?.data ?? raw;
  if (!profile || typeof profile !== 'object') {
    return nameValidationRejected(normalizedUrl, 'profile_not_found');
  }
  const returnedUrl = normalizeLinkedInProfileUrl(profile.linkedinUrl);
  if (!returnedUrl) {
    return nameValidationRejected(normalizedUrl, 'profile_url_missing');
  }
  if (returnedUrl.toLowerCase() !== normalizedUrl.toLowerCase()) {
    return nameValidationRejected(normalizedUrl, 'profile_url_mismatch');
  }
  return namePartMatches(row.first_name, profile.firstName) &&
    namePartMatches(row.last_name, profile.lastName)
    ? normalizedUrl
    : nameValidationRejected(normalizedUrl, 'name_mismatch');
}

type LinkedinWorkingRow = PersonToLinkedInInput & {
  serper_company_anchor?: string;
  primary?: unknown;
  name_only?: unknown;
  email_lookup?: unknown;
  candidate?: LinkedinWaterfallResult;
  name_to_linkedin_url_waterfall?: LinkedinWaterfallResult;
  validate?: unknown;
  fallback?: unknown;
  serper_name_validate?: unknown;
  serper_name_candidate_fallback?: unknown;
};

function serperCompanyAnchor(row: PersonToLinkedInInput): string {
  return [stringOrNull(row.company_name), stringOrNull(row.domain)]
    .filter((value): value is string => Boolean(value))
    .map((value) => `"${value}"`)
    .join(' ');
}

function linkedinWaterfallSteps<T extends LinkedinWorkingRow>() {
  return steps<T>()
    .step(
      'primary',
      async (row, ctx) => {
        try {
          const serper_linkedin_search_with_company_raw =
            await ctx.tools.execute({
              id: 'serper_linkedin_search_with_company',
              tool: 'serper_google_search',
              input: {
                query: `site:linkedin.com/in "${row.first_name ?? ''} ${row.last_name ?? ''}" ${row.serper_company_anchor as any}`,
                num: 5,
              },
              description: 'serper_linkedin_search_with_company',
            });
          return (
            normalizeLinkedInProfileUrl(
              serper_linkedin_search_with_company_raw.extractedValues.linkedin?.get(),
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
        runIf: (row) => Boolean(row.serper_company_anchor as any),
      },
    )
    .step(
      'name_only',
      async (row, ctx) => {
        try {
          const serper_linkedin_search_name_only_raw = await ctx.tools.execute({
            id: 'serper_linkedin_search_name_only',
            tool: 'serper_google_search',
            input: {
              query: `site:linkedin.com/in "${row.first_name ?? ''} ${row.last_name ?? ''}"`,
              num: 10,
            },
            description: 'serper_linkedin_search_name_only',
          });
          return (
            normalizeLinkedInProfileUrl(
              serper_linkedin_search_name_only_raw.extractedValues.linkedin?.get(),
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
        runIf: (row) => waterfallMiss(row.primary),
      },
    )
    .step(
      'email_lookup',
      async (row, ctx) => {
        try {
          const crustdata_v2_email_to_linkedin_raw = await ctx.tools.execute({
            id: 'crustdata_v2_email_to_linkedin',
            tool: 'crustdata_v2_enrich_person',
            input: {
              business_email: row.email ?? '',
              fields:
                'linkedin_profile_url,linkedin_flagship_url,name,email,title,current_employers',
            },
            description: 'crustdata_v2_email_to_linkedin',
          });
          const declaredLinkedin =
            crustdata_v2_email_to_linkedin_raw.extractedValues.linkedin?.get();
          const declaredUrl = normalizeLinkedInProfileUrl(declaredLinkedin);
          if (declaredUrl) {
            return declaredUrl;
          }
          return (
            (() => {
              const getPath = (source: any, path: string): unknown =>
                path.split('.').reduce((current: any, part: string) => {
                  if (current == null) return undefined;
                  const match = part.match(/^([^\[]+)\[(\d+)\]$/);
                  if (match) return current[match[1]!]?.[Number(match[2])];
                  return current[part];
                }, source);
              for (const target of [
                'data.linkedin_flagship_url',
                'data.linkedin_url',
                'data.profile.linkedin_url',
                'data[0].linkedin_flagship_url',
                'data[0].linkedin_profile_url',
                'result[0].linkedin_flagship_url',
                'result[0].linkedin_profile_url',
                'result.result[0].linkedin_flagship_url',
                'result.result[0].linkedin_profile_url',
                '[0].linkedin_flagship_url',
                '[0].linkedin_profile_url',
              ]) {
                const direct = normalizeLinkedInProfileUrl(
                  crustdata_v2_email_to_linkedin_raw.extractedValues[
                    target
                  ]?.get(),
                );
                if (direct) return direct;
                const value = getPath(
                  crustdata_v2_email_to_linkedin_raw,
                  target,
                );
                const url = normalizeLinkedInProfileUrl(value);
                if (url) return url;
              }
              return null;
            })() ?? noResultWaterfallAttempt()
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
          waterfallMiss(row.primary) &&
          waterfallMiss(row.name_only) &&
          Boolean(row.email ?? ''),
      },
    )
    .return((row): LinkedinWaterfallResult => {
      const candidates: Array<[string, unknown]> = [
        ['serper_linkedin_search_with_company', row.primary],
        ['serper_linkedin_search_name_only', row.name_only],
        ['crustdata_v2_email_to_linkedin', row.email_lookup],
      ];
      for (const [source, value] of candidates) {
        const url = normalizeLinkedInProfileUrl(value);
        if (url) {
          return {
            url,
            source,
            waterfall_attempts: waterfallAttempts(row, [
              'primary',
              'name_only',
              'email_lookup',
            ]),
          };
        }
      }
      return {
        url: null,
        source: null,
        waterfall_attempts: waterfallAttempts(row, [
          'primary',
          'name_only',
          'email_lookup',
        ]),
      };
    });
}

function linkedinResultSteps<T extends LinkedinWorkingRow>() {
  return steps<T>()
    .step('candidate', linkedinWaterfallSteps())
    .step(
      'validate',
      async (row, ctx) => {
        try {
          const result = row.candidate;
          const url =
            result && typeof result === 'object' ? result.url : result;
          if (!url || typeof url !== 'string') {
            return nameValidationRejected(null, 'no_candidate');
          }

          const profileResponse = await ctx.tools.execute({
            id: 'harvestapi_profile_validate',
            tool: 'harvestapi_get_profile',
            input: {
              url,
              main: 'true',
            },
            description:
              'Retrieve the candidate LinkedIn profile and verify its identity.',
          });
          return validateLinkedinCandidate(row, url, profileResponse);
        } catch (error: unknown) {
          if (isProviderUnavailable(error)) {
            return unavailableWaterfallAttempt(error);
          }
          throw error;
        }
      },
      {
        runIf: (row) => {
          const result = row.candidate;
          const url = result?.url;
          return typeof url === 'string' && url.length > 0;
        },
      },
    )
    .step(
      'fallback',
      async (row, ctx) => {
        let serper_name_candidate_fallback_raw;
        try {
          serper_name_candidate_fallback_raw = await ctx.tools.execute({
            id: 'serper_name_candidate_fallback',
            tool: 'serper_google_search',
            input: {
              query: `"${row.first_name ?? ''} ${row.last_name ?? ''}" site:linkedin.com/in`,
              num: 10,
            },
            description: 'serper_name_candidate_fallback',
          });
        } catch (error: unknown) {
          if (isProviderUnavailable(error)) {
            return unavailableWaterfallAttempt(error);
          }
          throw error;
        }
        const raw = serper_name_candidate_fallback_raw.toolResponse?.raw as any;
        const organic = Array.isArray(raw?.organic) ? raw.organic : [];
        const first = String(row.first_name || '')
          .toLowerCase()
          .trim();
        const last = String(row.last_name || '')
          .toLowerCase()
          .trim();
        if (first.length <= 1 || last.length <= 1)
          return noResultWaterfallAttempt();
        const company = String(row.company_name || row.domain || '')
          .toLowerCase()
          .replace(/^www\./, '')
          .trim();
        const scored = organic
          .map((r: any) => {
            const title = String(r.title || '').toLowerCase();
            const snippet = String(r.snippet || '').toLowerCase();
            const link = String(r.link || '');
            const normalizedLink = normalizeLinkedInProfileUrl(link);
            if (!normalizedLink) return null;
            if (!title.includes(last)) return null;
            if (!title.includes(first)) return null;
            const companyScore =
              company && (title.includes(company) || snippet.includes(company))
                ? 2
                : 0;
            const exactTitleScore = title.startsWith(first + ' ' + last)
              ? 2
              : 0;
            return {
              link: normalizedLink,
              score: companyScore + exactTitleScore,
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => b.score - a.score);
        const initialCandidateUrl = normalizeLinkedInProfileUrl(
          row.candidate?.url,
        );
        let lastRejection: Record<string, unknown> | null = null;
        for (const candidate of scored) {
          if (candidate.link === initialCandidateUrl) continue;
          try {
            const profileResponse = await ctx.tools.execute({
              id: 'harvestapi_profile_validate_fallback',
              tool: 'harvestapi_get_profile',
              input: {
                url: candidate.link,
                main: 'true',
              },
              description:
                'Retrieve a fallback LinkedIn candidate and verify its identity.',
            });
            const validated = validateLinkedinCandidate(
              row,
              candidate.link,
              profileResponse,
            );
            if (typeof validated === 'string') return validated;
            lastRejection = validated;
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        }
        return lastRejection ?? noResultWaterfallAttempt();
      },
      {
        runIf: (row) => waterfallMiss(row.validate),
      },
    )
    .return((row) => {
      // row.validate/row.fallback can now hold a rejection/no_result marker
      // object as well as a bare `null`, so only a real URL string counts as
      // a hit here — a plain `??` would wrongly treat a marker as the answer.
      const validateUrl =
        typeof row.validate === 'string' ? row.validate : null;
      const fallbackUrl =
        typeof row.fallback === 'string' ? row.fallback : null;
      const linkedin_url = validateUrl ?? fallbackUrl ?? null;
      const linkedin_source = validateUrl
        ? row.candidate?.source
        : fallbackUrl
          ? 'serper_name_candidate_fallback'
          : null;
      return {
        linkedin_url,
        linkedin_source,
        serper_name_validate: linkedin_url,
        waterfall_attempts: {
          ...candidateWaterfallAttempts(row.candidate),
          ...waterfallAttempts(row, OUTER_ATTEMPT_FIELDS),
        },
      };
    });
}

/**
 * Resolve LinkedIn profile URL from first name, last name, and optional company context. Tier 1: Serper Google dork (site:linkedin.com/in) anchored on domain or company_name when available, then name-only Serper. Tier 2 fallback: Crustdata person enrichment from email. Post-resolution: HarvestAPI profile retrieval with first-name, last-name, and returned-URL validation. A final Serper result scan runs only after validation rejects the first candidate.
 *
 */
export const scalar = definePlay(
  'person-to-linkedin-harvestapi',
  async (
    ctx,
    input: {
      first_name: string;
      last_name: string;
      domain?: string;
      company_name?: string;
      email?: string;
    },
  ): Promise<Record<string, unknown>> => {
    // Derived fields
    // @mermaid-node searchAnchor out:"serper_company_anchor"
    const serper_company_anchor = serperCompanyAnchor(input);

    const playInput = {
      ...input,
      serper_company_anchor,
    } as LinkedinWorkingRow;

    // @mermaid-node cascade out:"$output"
    return await ctx.runSteps(
      linkedinResultSteps<LinkedinWorkingRow>(),
      playInput,
    );
  },
  {
    description:
      'Find a LinkedIn profile from a person name and company context.',
  },
);

export const batch = definePlay(
  'person-to-linkedin-harvestapi-batch',
  async (
    ctx,
    input: {
      csv: CsvInput<PersonToLinkedInInput>;
      columns?: ColumnMap<PersonToLinkedInInput>;
    },
  ): Promise<Record<string, unknown>> => {
    // @mermaid-node people type:"dataset" out:"people"
    const people = await ctx.csv<PersonToLinkedInInput>(input.csv, {
      description: 'Load people rows for LinkedIn profile resolution.',
      columns: {
        ...DEFAULT_COLUMNS,
        ...input.columns,
      },
      required: ['first_name', 'last_name'],
    });

    // @mermaid-node profiles type:"dataset" out:"rows"
    const rows = await ctx
      .dataset('linkedin_rows', people)
      // @mermaid-node anchor out:"serper_company_anchor"
      .withColumn('serper_company_anchor', (row) => serperCompanyAnchor(row))
      // @mermaid-node waterfall out:"linkedin_result"
      .withColumn('linkedin_result', linkedinResultSteps())
      .withColumn(
        'linkedin_url',
        (row) => (row.linkedin_result as any)?.linkedin_url ?? null,
      )
      .withColumn(
        'linkedin_source',
        (row) => (row.linkedin_result as any)?.linkedin_source ?? null,
      )
      .withColumn(
        'serper_name_validate',
        (row) => (row.linkedin_result as any)?.serper_name_validate ?? null,
      )
      .withColumn(
        'waterfall_attempts',
        (row) => (row.linkedin_result as any)?.waterfall_attempts ?? {},
      )
      .run({
        description: 'Resolve LinkedIn profile URLs for each person row.',
        undrawnColumns: [
          'linkedin_url',
          'linkedin_source',
          'serper_name_validate',
          'waterfall_attempts',
        ],
      });

    // @mermaid-node out out:"$output"
    return { rows };
  },
  {
    description:
      'Resolve LinkedIn profile URLs for a CSV of people with name and company context.',
  },
);

export default scalar;
