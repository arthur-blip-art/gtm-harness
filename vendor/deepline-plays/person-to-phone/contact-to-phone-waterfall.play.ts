/** @mermaid scalar
 * flowchart TD
 * subgraph cascade["Try each provider; Trestle validates inline, keep going if it rejects"]
 *   wiza["Wiza"] --> datagmaEmail["Datagma · from email"]
 *   datagmaEmail --> datagmaLi["Datagma · from LinkedIn"]
 *   datagmaLi --> native["Deepline directory"]
 *   native --> leadmagicLi["LeadMagic · from LinkedIn"]
 *   leadmagicLi --> leadmagicEmail["LeadMagic · from email"]
 *   leadmagicEmail --> fullenrich["FullEnrich"]
 *   fullenrich --> aiArk["AI Ark (disabled)"]
 * end
 * cascade --> answer["Return the first accepted number"]
 */
/** @mermaid batch
 * flowchart TD
 * contacts[("People rows")] --> phones[("Phone rows")]
 * phones --> loop
 * subgraph loop["For each person"]
 *   waterfall["Find a mobile number"]
 * end
 * loop --> out["Return enriched rows"]
 */
import { definePlay, isProviderUnavailable, steps } from 'deepline';
import type { ColumnMap, CsvInput } from 'deepline';
import {
  noResultWaterfallAttempt,
  unavailableWaterfallAttempt,
  waterfallAttempts,
} from './waterfall-attempts';

type PersonPhoneInput = Record<string, unknown> & {
  first_name: string;
  last_name: string;
  domain?: string;
  email?: string;
  linkedin_url?: string;
};

type PersonPhoneColumn =
  | 'first_name'
  | 'last_name'
  | 'domain'
  | 'email'
  | 'linkedin_url';

const DEFAULT_COLUMNS = {
  first_name: 'FIRST_NAME',
  last_name: 'LAST_NAME',
  domain: 'COMPANY_DOMAIN',
  email: 'CONTACT_EMAIL',
  linkedin_url: 'LINKEDIN_URL',
} as const satisfies Record<PersonPhoneColumn, string>;

function stringOrNull(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = stringOrNull(item);
      if (candidate) return candidate;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    return stringOrNull((value as Record<string, unknown>).phone);
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Providers return miss sentinels ("unfound") and truncated junk ("58") in the
// same field that carries real numbers. Every one of those used to reach
// Trestle as a billed validation call, so a single row could spend two charges
// establishing that "unfound" is not a phone number.
//
// This guard is deliberately permissive about FORMAT so international numbers
// survive: "+44 7911 123456", "(555) 123-4567", "0049-151-12345678", and
// "+91 98765 43210" all pass. It rejects only values that cannot be a phone
// number at any length, and leaves every real judgement to Trestle.
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  // "00" is the international access prefix across most of the world, so
  // 0044 7911 123456 is the same number as +44 7911 123456. Strip it before
  // the length check, or a correctly formatted international number gets
  // pushed past the 15-digit E.164 ceiling and thrown away as junk.
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

function isLikelyPhone(value: string): boolean {
  const digits = phoneDigits(value);
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

/**
 * Classify what a provider's phone field actually contained.
 *
 * A usable candidate passes through as a plain string. Anything else becomes a
 * `no_result` marker so the existing selectors keep treating it as a miss,
 * while the discarded value stays visible in `waterfall_attempts` — a provider
 * answering "unfound" is worth seeing, and is not the same as it answering
 * nothing at all.
 */
function phoneCandidateOutcome(
  candidate: string | null,
): string | Record<string, unknown> {
  if (!candidate) return noResultWaterfallAttempt();
  if (isLikelyPhone(candidate)) return candidate;
  return {
    ...noResultWaterfallAttempt(),
    discarded_candidate: candidate,
    reject_reason: 'not_a_phone_number',
  };
}

/** A candidate worth spending a billed Trestle validation call on. */
function phoneCandidateOrNull(value: unknown): string | null {
  const candidate = stringOrNull(value);
  return candidate && isLikelyPhone(candidate) ? candidate : null;
}

function domainFromEmail(email?: string): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  if (!trimmed || !isLikelyEmail(trimmed)) return undefined;
  const domain = trimmed.replace(/^[^@]+@/, '');
  return domain.replace(/^www\./, '') || undefined;
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

function normalizeEmail(value?: string): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && isLikelyEmail(trimmed) ? trimmed : undefined;
}

function normalizeDomain(value?: string): string | undefined {
  const raw = value?.trim().toLowerCase();
  if (!raw) return undefined;
  const withoutProtocol = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const withoutPath = withoutProtocol.split(/[/?#]/, 1)[0] ?? '';
  return withoutPath.replace(/^www\./, '') || undefined;
}

function normalizePersonPhoneInput(row: PersonPhoneInput): PersonPhoneInput {
  const email = normalizeEmail(row.email);
  const domain = normalizeDomain(row.domain) ?? domainFromEmail(email);
  return {
    ...row,
    first_name: row.first_name.trim(),
    last_name: row.last_name.trim(),
    domain,
    email,
    linkedin_url: row.linkedin_url?.trim() || undefined,
  };
}

function hasUsableAnchor(row: PersonPhoneInput): boolean {
  const input = normalizePersonPhoneInput(row);
  return Boolean(input.linkedin_url || input.email || input.domain);
}

type PhoneWaterfallRow = PersonPhoneInput & {
  ai_ark_mobile?: unknown;
  wiza_phone?: unknown;
  wiza_phone_trestle_validation?: unknown;
  datagma_mobile_from_email?: unknown;
  datagma_mobile_from_email_trestle_validation?: unknown;
  datagma_mobile_from_linkedin?: unknown;
  datagma_mobile_from_linkedin_trestle_validation?: unknown;
  native_phone?: unknown;
  native_phone_trestle_validation?: unknown;
  leadmagic_mobile_from_linkedin?: unknown;
  leadmagic_mobile_from_linkedin_trestle_validation?: unknown;
  leadmagic_mobile_from_email?: unknown;
  leadmagic_mobile_from_email_trestle_validation?: unknown;
  fullenrich_phone?: unknown;
  fullenrich_phone_trestle_validation?: unknown;
  upcell_phone?: unknown;
};

type PhoneWaterfallResult = {
  phone: string | null;
  source: string | null;
  validated: boolean;
  validation_status: string | null;
  activity_score: number | null;
  activity_band: string | null;
  line_type: string | null;
  carrier: string | null;
  reject_reason: string | null;
  waterfall_attempts: Record<string, unknown>;
};

// Execution order, ranked by real production hit rate (highest first): Wiza
// (98.4%) → Datagma (56.9% email / from LinkedIn) → the free Deepline
// directory lookup (55.1%) → LeadMagic (30.4%) → FullEnrich (10.1%). Forager
// is dropped entirely: 0/374 production calls ever returned a phone.
//
// Each provider validates its own candidate with Trestle immediately, so a
// rejected candidate falls through to the next provider instead of ending
// the run. This means more Trestle calls (and more spend) than validating
// once at the end, in exchange for a much better chance of landing a real,
// currently-active number. One column per actual tool call: every provider
// gets its own finder cell and its own `_trestle_validation` cell.
const TRESTLE_VALIDATION_FIELDS = [
  'wiza_phone_trestle_validation',
  'datagma_mobile_from_email_trestle_validation',
  'datagma_mobile_from_linkedin_trestle_validation',
  'native_phone_trestle_validation',
  'leadmagic_mobile_from_linkedin_trestle_validation',
  'leadmagic_mobile_from_email_trestle_validation',
  'fullenrich_phone_trestle_validation',
] as const;

const PHONE_ATTEMPT_FIELDS = [
  'wiza_phone',
  'wiza_phone_trestle_validation',
  'datagma_mobile_from_email',
  'datagma_mobile_from_email_trestle_validation',
  'datagma_mobile_from_linkedin',
  'datagma_mobile_from_linkedin_trestle_validation',
  'native_phone',
  'native_phone_trestle_validation',
  'leadmagic_mobile_from_linkedin',
  'leadmagic_mobile_from_linkedin_trestle_validation',
  'leadmagic_mobile_from_email',
  'leadmagic_mobile_from_email_trestle_validation',
  'fullenrich_phone',
  'fullenrich_phone_trestle_validation',
  'ai_ark_mobile',
  'upcell_phone',
] as const;

function phoneResultField(
  row: Record<string, unknown>,
  field: keyof PhoneWaterfallResult,
): string | number | boolean | null {
  const result = row.phone_result;
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const value = (result as Record<string, unknown>)[field];
  if (field === 'validated') return value === true;
  if (field === 'activity_score') {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  return stringOrNull(value);
}

function phoneResultWaterfallAttempts(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const result = row.phone_result;
  return result !== null && typeof result === 'object' && !Array.isArray(result)
    ? ((result as Record<string, unknown>).waterfall_attempts as Record<
        string,
        unknown
      >)
    : {};
}

type PhoneValidationResult = {
  phone: string;
  validation_status: string;
  activity_score: number | null;
  activity_band: string | null;
  line_type: string | null;
  carrier: string | null;
  reject_reason: null;
};

// A provider found a candidate and Trestle billably validated it, but the
// candidate was invalid or stale. Distinct from a bare `null` (provider
// found nothing, or was skipped) so waterfall_attempts shows what a charged
// validation call actually returned instead of erasing it, and distinct from
// an accepted result so the waterfall knows to try the next provider.
type PhoneValidationRejection = {
  phone: null;
  outcome: 'trestle_rejected';
  candidate_phone: string;
  validation_status: string | null;
  activity_score: number | null;
  activity_band: string | null;
  line_type: string | null;
  carrier: string | null;
  reject_reason: string;
};

function rawObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function activityBand(score: number | null): string | null {
  if (score == null) return 'unknown';
  if (score >= 70) return 'active';
  if (score < 30) return 'stale';
  return 'risky';
}

function validatedPhone(
  raw: {
    extractedValues: Record<string, { get(): unknown } | undefined>;
    toolOutput?: { raw?: unknown };
    toolResponse?: { raw?: unknown };
  },
  rawPhone: string,
): PhoneValidationResult | PhoneValidationRejection {
  const ev = raw.extractedValues;
  const phoneStatus = String(ev['phone_status']?.get() ?? '').toLowerCase();
  const rawPayload = rawObject(raw.toolOutput?.raw ?? raw.toolResponse?.raw);
  const rawData = rawObject(rawPayload.data);
  const activityScoreRaw = rawData.activity_score ?? rawPayload.activity_score;
  const activityScore = Number(activityScoreRaw);
  const normalizedScore = Number.isFinite(activityScore) ? activityScore : null;
  const lineType = stringOrNull(rawData.line_type ?? rawPayload.line_type);
  const carrier = stringOrNull(rawData.carrier ?? rawPayload.carrier);
  const band = activityBand(normalizedScore);
  const stale = normalizedScore !== null && normalizedScore < 30;
  if (phoneStatus !== 'valid' || stale) {
    return {
      phone: null,
      outcome: 'trestle_rejected',
      candidate_phone: rawPhone,
      validation_status: phoneStatus || null,
      activity_score: normalizedScore,
      activity_band: band,
      line_type: lineType,
      carrier,
      reject_reason: stale
        ? 'stale_activity_score'
        : `trestle_status_${phoneStatus || 'unknown'}`,
    };
  }
  return {
    phone: stringOrNull(ev['phone']?.get()) ?? rawPhone,
    validation_status: phoneStatus,
    activity_score: normalizedScore,
    activity_band: band,
    line_type: lineType,
    carrier,
    reject_reason: null,
  };
}

// The first Trestle-accepted candidate across all providers tried so far, in
// execution order. Not a plain `??` chain: a rejected candidate is a truthy
// object too, so `??` would stop at the first provider that ran instead of
// finding the later provider that actually got accepted.
function acceptedPhoneFromWaterfallRow(
  row: Record<string, unknown>,
): { phone: string; source: string; validation: PhoneValidationResult } | null {
  for (const field of TRESTLE_VALIDATION_FIELDS) {
    const value = row[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const validation = value as PhoneValidationResult;
      const phone = stringOrNull(validation.phone);
      if (phone) {
        return {
          phone,
          source: field.replace(/_trestle_validation$/, ''),
          validation,
        };
      }
    }
  }
  return null;
}

function noAcceptedPhone(row: PhoneWaterfallRow): boolean {
  return acceptedPhoneFromWaterfallRow(row) === null;
}

// The most recent rejection any provider's Trestle call actually returned —
// surfaced at the top level so a customer whose run ended with no accepted
// phone still sees why the last real candidate was thrown out.
function lastRejectionFromWaterfallRow(
  row: Record<string, unknown>,
): PhoneValidationRejection | null {
  let last: PhoneValidationRejection | null = null;
  for (const field of TRESTLE_VALIDATION_FIELDS) {
    const value = row[field];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as PhoneValidationRejection).outcome === 'trestle_rejected'
    ) {
      last = value as PhoneValidationRejection;
    }
  }
  return last;
}

function personToPhoneSteps<T extends PersonPhoneInput>() {
  return (
    steps<T>()
      // @mermaid-node wiza out:"wiza_phone"
      .step(
        'wiza_phone',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const input = normalizePersonPhoneInput(row);
            const raw = await ctx.tools.execute({
              id: 'wiza_phone',
              tool: 'wiza_reveal_person',
              input: {
                ...(input.linkedin_url
                  ? { linkedin_url: input.linkedin_url }
                  : {}),
                ...(input.email ? { email: input.email } : {}),
                first_name: input.first_name,
                last_name: input.last_name,
                ...(input.domain ? { company_domain: input.domain } : {}),
                enrichment_level: 'phone',
              },
              description: 'wiza_phone',
            });
            const phone = stringOrNull(raw.extractedValues.phone?.get());
            return phoneCandidateOutcome(phone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            noAcceptedPhone(row) && hasUsableAnchor(row),
        },
      )
      .step(
        'wiza_phone_trestle_validation',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const rawPhone = phoneCandidateOrNull(row.wiza_phone);
            if (!rawPhone) return null;
            const validation = await ctx.tools.execute({
              id: 'wiza_phone_trestle_validation',
              tool: 'trestle_phone_validation',
              description: 'wiza_phone_trestle_validation',
              input: { phone: rawPhone },
            });
            return validatedPhone(validation, rawPhone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            phoneCandidateOrNull(row.wiza_phone) != null,
        },
      )
      // @mermaid-node datagmaEmail out:"datagma_mobile_from_email"
      .step(
        'datagma_mobile_from_email',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const input = normalizePersonPhoneInput(row);
            const raw = await ctx.tools.execute({
              id: 'datagma_mobile_from_email',
              tool: 'datagma_search_phone_numbers',
              input: {
                email: input.email ?? '',
              },
              description: 'datagma_mobile_from_email',
            });
            const phone = stringOrNull(raw.extractedValues.phone?.get());
            return phoneCandidateOutcome(phone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            noAcceptedPhone(row) &&
            Boolean(normalizePersonPhoneInput(row).email),
        },
      )
      .step(
        'datagma_mobile_from_email_trestle_validation',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const rawPhone = phoneCandidateOrNull(
              row.datagma_mobile_from_email,
            );
            if (!rawPhone) return null;
            const validation = await ctx.tools.execute({
              id: 'datagma_mobile_from_email_trestle_validation',
              tool: 'trestle_phone_validation',
              description: 'datagma_mobile_from_email_trestle_validation',
              input: { phone: rawPhone },
            });
            return validatedPhone(validation, rawPhone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            phoneCandidateOrNull(row.datagma_mobile_from_email) != null,
        },
      )
      // @mermaid-node datagmaLi out:"datagma_mobile_from_linkedin"
      .step(
        'datagma_mobile_from_linkedin',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const input = normalizePersonPhoneInput(row);
            const raw = await ctx.tools.execute({
              id: 'datagma_mobile_from_linkedin',
              tool: 'datagma_search_phone_numbers',
              input: {
                username: input.linkedin_url ?? '',
              },
              description: 'datagma_mobile_from_linkedin',
            });
            const phone = stringOrNull(raw.extractedValues.phone?.get());
            return phoneCandidateOutcome(phone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            noAcceptedPhone(row) &&
            Boolean(normalizePersonPhoneInput(row).linkedin_url),
        },
      )
      .step(
        'datagma_mobile_from_linkedin_trestle_validation',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const rawPhone = phoneCandidateOrNull(
              row.datagma_mobile_from_linkedin,
            );
            if (!rawPhone) return null;
            const validation = await ctx.tools.execute({
              id: 'datagma_mobile_from_linkedin_trestle_validation',
              tool: 'trestle_phone_validation',
              description: 'datagma_mobile_from_linkedin_trestle_validation',
              input: { phone: rawPhone },
            });
            return validatedPhone(validation, rawPhone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            phoneCandidateOrNull(row.datagma_mobile_from_linkedin) != null,
        },
      )
      // @mermaid-node native out:"native_phone"
      .step(
        'native_phone',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const input = normalizePersonPhoneInput(row);
            const raw = await ctx.tools.execute({
              id: 'native_phone',
              tool: 'deepline_native_enrich_phone',
              // Omit absent anchors instead of sending empty strings. This
              // step's runIf admits a row with no LinkedIn URL, and the
              // provider rejects `linkedin: ''` outright with a bare "Bad
              // request" that names nothing. Dropping the empty field lets it
              // answer on the anchors that are actually present, and when it
              // still refuses it says which field was wrong.
              input: {
                ...(input.linkedin_url ? { linkedin: input.linkedin_url } : {}),
                ...(input.email ? { email: input.email } : {}),
                first_name: input.first_name,
                last_name: input.last_name,
                ...(input.domain ? { domain: input.domain } : {}),
              },
              description: 'native_phone',
            });
            const phone = stringOrNull(raw.extractedValues.phone?.get());
            return phoneCandidateOutcome(phone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            noAcceptedPhone(row) && hasUsableAnchor(row),
        },
      )
      .step(
        'native_phone_trestle_validation',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const rawPhone = phoneCandidateOrNull(row.native_phone);
            if (!rawPhone) return null;
            const validation = await ctx.tools.execute({
              id: 'native_phone_trestle_validation',
              tool: 'trestle_phone_validation',
              description: 'native_phone_trestle_validation',
              input: { phone: rawPhone },
            });
            return validatedPhone(validation, rawPhone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            phoneCandidateOrNull(row.native_phone) != null,
        },
      )
      // @mermaid-node leadmagicLi out:"leadmagic_mobile_from_linkedin"
      .step(
        'leadmagic_mobile_from_linkedin',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const input = normalizePersonPhoneInput(row);
            const raw = await ctx.tools.execute({
              id: 'leadmagic_mobile_from_linkedin',
              tool: 'leadmagic_mobile_finder',
              input: {
                profile_url: input.linkedin_url ?? '',
              },
              description: 'leadmagic_mobile_from_linkedin',
            });
            const fullenrichValues = raw.extractedValues as Record<
              string,
              { get(): unknown } | undefined
            >;
            const phone = stringOrNull(fullenrichValues.phone?.get());
            return phoneCandidateOutcome(phone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            noAcceptedPhone(row) &&
            Boolean(normalizePersonPhoneInput(row).linkedin_url),
        },
      )
      .step(
        'leadmagic_mobile_from_linkedin_trestle_validation',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const rawPhone = phoneCandidateOrNull(
              row.leadmagic_mobile_from_linkedin,
            );
            if (!rawPhone) return null;
            const validation = await ctx.tools.execute({
              id: 'leadmagic_mobile_from_linkedin_trestle_validation',
              tool: 'trestle_phone_validation',
              description: 'leadmagic_mobile_from_linkedin_trestle_validation',
              input: { phone: rawPhone },
            });
            return validatedPhone(validation, rawPhone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            phoneCandidateOrNull(row.leadmagic_mobile_from_linkedin) != null,
        },
      )
      // @mermaid-node leadmagicEmail out:"leadmagic_mobile_from_email"
      .step(
        'leadmagic_mobile_from_email',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const input = normalizePersonPhoneInput(row);
            const raw = await ctx.tools.execute({
              id: 'leadmagic_mobile_from_email',
              tool: 'leadmagic_mobile_finder',
              input: {
                work_email: input.email ?? '',
              },
              description: 'leadmagic_mobile_from_email',
            });
            const phone = stringOrNull(raw.extractedValues.phone?.get());
            return phoneCandidateOutcome(phone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            noAcceptedPhone(row) &&
            Boolean(normalizePersonPhoneInput(row).email),
        },
      )
      .step(
        'leadmagic_mobile_from_email_trestle_validation',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const rawPhone = phoneCandidateOrNull(
              row.leadmagic_mobile_from_email,
            );
            if (!rawPhone) return null;
            const validation = await ctx.tools.execute({
              id: 'leadmagic_mobile_from_email_trestle_validation',
              tool: 'trestle_phone_validation',
              description: 'leadmagic_mobile_from_email_trestle_validation',
              input: { phone: rawPhone },
            });
            return validatedPhone(validation, rawPhone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            phoneCandidateOrNull(row.leadmagic_mobile_from_email) != null,
        },
      )
      // upcell is intentionally disabled until we have a configured provider key
      // for live eval and production preflight coverage.
      // .step(
      //   'upcell_phone',
      //   async (row: PhoneWaterfallRow, ctx) => {
      //     const input = normalizePersonPhoneInput(row);
      //     const raw = await ctx.tools.execute({
      //       id: 'upcell_phone',
      //       tool: 'upcell_enrich_contact',
      //       input: {
      //         ...(input.linkedin_url ? { linkedinUrl: input.linkedin_url } : {}),
      //         firstName: input.first_name,
      //         lastName: input.last_name,
      //         ...(input.domain ? { companyDomain: input.domain } : {}),
      //         fields: ['mobile'],
      //       },
      //       description: 'upcell_phone',
      //     });
      //     const ev = raw.extractedValues as Record<
      //       string,
      //       { get(): unknown } | undefined
      //     >;
      //     const phone = stringOrNull(ev['mobile']?.get() ?? ev['phone']?.get());
      //     return phoneCandidateOutcome(phone);
      //   },
      //   {
      //     runIf: (row: PhoneWaterfallRow) => noAcceptedPhone(row) && hasUsableAnchor(row),
      //   },
      // )
      // @mermaid-node fullenrich out:"fullenrich_phone"
      .step(
        'fullenrich_phone',
        async (row: PhoneWaterfallRow, ctx) => {
          const input = normalizePersonPhoneInput(row);
          let raw;
          try {
            raw = await ctx.tools.execute({
              id: 'fullenrich_phone',
              tool: 'fullenrich_bulk_enrich',
              input: {
                name: `phone-wf-${input.first_name}-${input.last_name}`,
                data: [
                  {
                    first_name: input.first_name,
                    last_name: input.last_name,
                    enrich_fields: ['contact.phones'],
                    ...(input.domain ? { domain: input.domain } : {}),
                    ...(input.linkedin_url
                      ? { linkedin_url: input.linkedin_url }
                      : {}),
                  },
                ],
              },
              description: 'fullenrich_phone',
            });
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
          const fullenrichValues = raw.extractedValues as Record<
            string,
            { get(): unknown } | undefined
          >;
          const phone = stringOrNull(fullenrichValues.phone?.get());
          return phoneCandidateOutcome(phone);
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            noAcceptedPhone(row) && hasUsableAnchor(row),
        },
      )
      .step(
        'fullenrich_phone_trestle_validation',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const rawPhone = phoneCandidateOrNull(row.fullenrich_phone);
            if (!rawPhone) return null;
            const validation = await ctx.tools.execute({
              id: 'fullenrich_phone_trestle_validation',
              tool: 'trestle_phone_validation',
              description: 'fullenrich_phone_trestle_validation',
              input: { phone: rawPhone },
            });
            return validatedPhone(validation, rawPhone);
          } catch (error: unknown) {
            if (isProviderUnavailable(error)) {
              return unavailableWaterfallAttempt(error);
            }
            throw error;
          }
        },
        {
          runIf: (row: PhoneWaterfallRow) =>
            phoneCandidateOrNull(row.fullenrich_phone) != null,
        },
      )
      // AI Ark remains disabled pending reviewed billing behavior.
      // @mermaid-node aiArk out:"ai_ark_mobile"
      .step(
        'ai_ark_mobile',
        async (row: PhoneWaterfallRow, ctx) => {
          try {
            const input = normalizePersonPhoneInput(row);
            const raw = await ctx.tools.execute({
              id: 'ai_ark_mobile',
              tool: 'ai_ark_mobile_phone_finder',
              input: {
                linkedin: input.linkedin_url ?? '',
                name: `${input.first_name} ${input.last_name}`,
                domain: input.domain ?? '',
              },
              description: 'ai_ark_mobile',
            });
            const phone = stringOrNull(raw.extractedValues.phone?.get());
            return phoneCandidateOutcome(phone);
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
      .return((row: PhoneWaterfallRow) => {
        const accepted = acceptedPhoneFromWaterfallRow(row);
        const rejection = accepted ? null : lastRejectionFromWaterfallRow(row);
        return {
          phone: accepted?.phone ?? null,
          source: accepted?.source ?? null,
          validated: Boolean(accepted),
          validation_status: accepted
            ? stringOrNull(accepted.validation.validation_status)
            : stringOrNull(rejection?.validation_status),
          activity_score:
            accepted && typeof accepted.validation.activity_score === 'number'
              ? accepted.validation.activity_score
              : (rejection?.activity_score ?? null),
          activity_band: accepted
            ? stringOrNull(accepted.validation.activity_band)
            : stringOrNull(rejection?.activity_band),
          line_type: accepted
            ? stringOrNull(accepted.validation.line_type)
            : stringOrNull(rejection?.line_type),
          carrier: accepted
            ? stringOrNull(accepted.validation.carrier)
            : stringOrNull(rejection?.carrier),
          reject_reason: accepted
            ? null
            : stringOrNull(rejection?.reject_reason),
          waterfall_attempts: waterfallAttempts(row, PHONE_ATTEMPT_FIELDS),
        };
      })
  );
}

/**
 * Resolve and validate a direct phone number from known contact identity.
 * Enrichment waterfall, ordered by real production hit rate: Wiza (98.4%) → Datagma from email (56.9%) → Datagma from LinkedIn → deepline_native_enrich_phone (free, 55.1%) → LeadMagic from LinkedIn (30.4%) → LeadMagic from email → FullEnrich (10.1%). Forager is dropped: 0/374 production calls ever found a phone. AI Ark remains disabled pending reviewed billing behavior.
 * Each candidate is validated with trestle_phone_validation immediately after the provider that found it, not once at the end: is_valid, line_type, carrier, activity_score (≥70 = active, <30 = stale/auto-fail). A reject falls through to the next provider instead of ending the run — more Trestle calls in the worst case, but a much better chance of landing a real, currently-active number.
 *
 */
export const scalar = definePlay(
  'contact-to-phone-waterfall',
  async (ctx, input: PersonPhoneInput): Promise<Record<string, unknown>> => {
    // No `@mermaid-node` here: `cascade` is a SUBGRAPH in the scalar diagram,
    // and a subgraph is a region, not a node. Each attempt inside it binds to
    // its own leg above.
    const result = (await ctx.runSteps(
      personToPhoneSteps<PersonPhoneInput>(),
      input,
    )) as PhoneWaterfallResult;
    // @mermaid-node answer out:"$output"
    return {
      phone: result.phone,
      phone_source: result.source,
      phone_validated: result.validated,
      phone_validation_status: result.validation_status,
      phone_activity_score: result.activity_score,
      phone_activity_band: result.activity_band,
      phone_line_type: result.line_type,
      phone_carrier: result.carrier,
      phone_reject_reason: result.reject_reason,
      waterfall_attempts: result.waterfall_attempts,
    };
  },
  {
    description:
      'Find a mobile phone number for one person using a provider waterfall.',
  },
);

export const batch = definePlay(
  'person-to-phone-batch',
  async (
    ctx,
    input: {
      csv: CsvInput<PersonPhoneInput>;
      columns?: ColumnMap<PersonPhoneInput>;
    },
  ): Promise<Record<string, unknown>> => {
    // @mermaid-node contacts type:"dataset" out:"contacts"
    const contacts = await ctx.csv<PersonPhoneInput>(input.csv, {
      description: 'Load people rows for mobile-phone resolution.',
      columns: {
        ...DEFAULT_COLUMNS,
        ...input.columns,
      },
      required: ['first_name', 'last_name'],
    });
    // @mermaid-node phones type:"dataset" out:"rows"
    const rows = await ctx
      .dataset('mobile_phone_contacts', contacts)
      // @mermaid-node waterfall out:"phone_result"
      .withColumn('phone_result', personToPhoneSteps<PersonPhoneInput>())
      .withColumn('phone', (row) => phoneResultField(row, 'phone'))
      .withColumn('phone_source', (row) => phoneResultField(row, 'source'))
      .withColumn('phone_validated', (row) =>
        phoneResultField(row, 'validated'),
      )
      .withColumn('phone_validation_status', (row) =>
        phoneResultField(row, 'validation_status'),
      )
      .withColumn('phone_activity_score', (row) =>
        phoneResultField(row, 'activity_score'),
      )
      .withColumn('phone_activity_band', (row) =>
        phoneResultField(row, 'activity_band'),
      )
      .withColumn('phone_line_type', (row) =>
        phoneResultField(row, 'line_type'),
      )
      .withColumn('phone_carrier', (row) => phoneResultField(row, 'carrier'))
      .withColumn('phone_reject_reason', (row) =>
        phoneResultField(row, 'reject_reason'),
      )
      .withColumn('waterfall_attempts', (row) =>
        phoneResultWaterfallAttempts(row),
      )
      .run({
        description: 'Resolve a mobile phone number for each person row.',
      });

    // @mermaid-node out out:"$output"
    return { rows };
  },
  { description: 'Find mobile phone numbers for a CSV of people in one pass.' },
);

export default scalar;
