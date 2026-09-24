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

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Serper's canonical response is `rawV2.data.organic`; current responses can
 * put `organic` at the rawV2 root, while older persisted receipts have used
 * both `raw.organic` and `raw.data.organic`. Prefer the first non-empty
 * response, so an empty canonical list cannot discard an exact result in a
 * compatibility envelope.
 */
function serperOrganicResults(result: unknown): Array<Record<string, unknown>> {
  const toolResult = recordOrNull(result);
  const toolResponse = recordOrNull(toolResult?.toolResponse);
  const rawV2 = recordOrNull(toolResponse?.rawV2);
  const rawV2Data = recordOrNull(rawV2?.data);
  const raw = recordOrNull(toolResponse?.raw);
  const rawData = recordOrNull(raw?.data);
  const rawEmbeddedV2 = recordOrNull(raw?.rawV2);
  const rawEmbeddedV2Data = recordOrNull(rawEmbeddedV2?.data);
  const organic = [
    rawV2Data?.organic,
    rawV2?.organic,
    rawEmbeddedV2Data?.organic,
    rawEmbeddedV2?.organic,
    raw?.organic,
    rawData?.organic,
  ].find((value): value is unknown[] => Array.isArray(value) && value.length > 0);
  return (organic ?? []).filter((entry): entry is Record<string, unknown> =>
    Boolean(recordOrNull(entry)),
  );
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
  return stringOrNull(row.domain) ?? stringOrNull(row.company_name) ?? '';
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
                query: `site:linkedin.com/in "${row.first_name ?? ''} ${row.last_name ?? ''}" "${row.serper_company_anchor as any}"`,
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
    .return((row): LinkedinWaterfallResult => {
      const candidates: Array<[string, unknown]> = [
        ['serper_linkedin_search_with_company', row.primary],
        ['serper_linkedin_search_name_only', row.name_only],
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
          const serper_name_validate_raw = await ctx.tools.execute({
            id: 'serper_name_validate',
            tool: 'serper_google_search',
            input: {
              query: `"${row.first_name ?? ''} ${row.last_name ?? ''}" site:linkedin.com/in`,
              num: 5,
            },
            description: 'serper_name_validate',
          });
          const result = row.candidate;
          const url =
            result && typeof result === 'object' ? result.url : result;
          if (!url || typeof url !== 'string')
            return nameValidationRejected(null, 'no_candidate');
          const first = String(row.first_name || '')
            .toLowerCase()
            .trim();
          const last = String(row.last_name || '')
            .toLowerCase()
            .trim();
          if (!last) return nameValidationRejected(url, 'missing_last_name');
          const organic = serperOrganicResults(serper_name_validate_raw);
          const normalizedUrl = normalizeLinkedInProfileUrl(url)
            ?.replace(/\/+$/, '')
            .toLowerCase();
          if (!normalizedUrl)
            return nameValidationRejected(url, 'malformed_candidate_url');
          const slug = normalizedUrl.split('/in/')[1] || '';
          const slugNameOk =
            first.length > 1 && slug.includes(first) && slug.includes(last);
          const confirmed = organic.some((r: any) => {
            const title = (r.title || '').toLowerCase();
            const link = String(r.link || '')
              .replace(/\/+$/, '')
              .toLowerCase();
            const sameLink = link === normalizedUrl;
            const lastOk = title.includes(last);
            const firstOk = first.length <= 1 || title.includes(first);
            return sameLink && lastOk && firstOk;
          });
          return confirmed || slugNameOk
            ? normalizeLinkedInProfileUrl(url)
            : nameValidationRejected(url, 'name_mismatch');
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
        const organic = serperOrganicResults(
          serper_name_candidate_fallback_raw,
        );
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
        const best = scored[0];
        return best ? best.link : noResultWaterfallAttempt();
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
 * Resolve LinkedIn profile URL from first name, last name, and optional company context. Uses a Serper Google dork (site:linkedin.com/in) anchored on domain or company_name when available, with name-only Serper fallback. Post-resolution, Serper name-slug validation rejects false-positive URLs where the resolved slug does not contain any part of the person's name.
 *
 */
export const scalar = definePlay(
  'name-to-linkedin-url-waterfall',
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
  'person-to-linkedin-batch',
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
      .dataset('person_to_linkedin_rows', people)
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
