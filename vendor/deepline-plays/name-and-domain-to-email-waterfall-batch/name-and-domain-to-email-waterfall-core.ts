import { isProviderUnavailable, steps } from 'deepline';
import type {
  ColumnMap,
  CsvInput,
  DeeplinePlayRuntimeContext,
  ToolExecuteResult,
} from 'deepline';

export type PersonEmailWaterfallInput = Record<string, unknown> & {
  first_name: string;
  last_name: string;
  domain: string;
  company_name?: string;
  linkedin_url?: string;
};

export type PersonData = PersonEmailWaterfallInput;

export const DEFAULT_COLUMNS = {
  first_name: 'FIRST_NAME',
  last_name: 'LAST_NAME',
  domain: 'COMPANY_DOMAIN',
  company_name: 'COMPANY_NAME',
  linkedin_url: 'LINKEDIN_URL',
} as const satisfies Record<string, string>;

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDomain(value: unknown): string {
  const raw = trimmedString(value).toLowerCase();
  if (!raw) return '';
  const withoutProtocol = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const withoutPath = withoutProtocol.split(/[/?#]/, 1)[0] ?? '';
  return withoutPath.replace(/^www\./, '');
}

function isLikelyDomain(value: string): boolean {
  const domain = normalizeDomain(value);
  if (!domain || domain.length > 253) return false;
  if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.'))
    return false;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return false;
  return domain
    .split('.')
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function emailLocalName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
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

function normalizePersonEmailInput(row: PersonData): PersonData {
  const first_name = trimmedString(row.first_name);
  const last_name = trimmedString(row.last_name);
  const domain = normalizeDomain(row.domain);
  const company_name = trimmedString(row.company_name);
  const linkedin_url = trimmedString(row.linkedin_url);

  return {
    ...row,
    first_name,
    last_name,
    domain,
    company_name: company_name || undefined,
    linkedin_url: linkedin_url || undefined,
  };
}

type PersonEmailState = PersonData & {
  pattern_first_at?: unknown;
  pattern_flast?: unknown;
  pattern_first_dot_last?: unknown;
  pattern_firstl?: unknown;
  pattern_firstlast?: unknown;
  hunter_email?: unknown;
  leadmagic_email?: unknown;
  datagma_email?: unknown;
  findymail_email?: unknown;
  icypeas_email?: unknown;
  prospeo_verified_email?: unknown;
  native_email?: unknown;
  fullenrich_email?: unknown;
  lusha_email?: unknown;
  contactout_email?: unknown;
  pdl_email?: unknown;
};

export type EmailWaterfallResult = {
  email: string | null;
  source: string | null;
  /** Mailbox validation passed and the email domain matches the input domain. */
  validated: boolean;
  /** All executed waterfall legs, including provider-unavailable outcomes. */
  attempts: Record<string, unknown>;
  waterfall_attempts: Record<string, unknown>;
};

const EMAIL_SOURCE_FIELDS = [
  'pattern_first_at',
  'pattern_flast',
  'pattern_first_dot_last',
  'pattern_firstl',
  'pattern_firstlast',
  'hunter_email',
  'leadmagic_email',
  'datagma_email',
  'findymail_email',
  'icypeas_email',
  'prospeo_verified_email',
  'native_email',
  'fullenrich_email',
  'lusha_email',
  'contactout_email',
  'pdl_email',
] as const;

function stringOrNull(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = stringOrNull(item);
      if (candidate) return candidate;
    }
    return null;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function emailSourceFromPersonEmailState(
  row: Record<string, unknown>,
): string | null {
  return nextEmailFromPersonEmailState(row).source;
}

function emailFromPersonEmailState(row: PersonEmailState): string | null {
  return nextEmailFromPersonEmailState(row).email;
}

function nextEmailFromPersonEmailState(
  row: Record<string, unknown>,
): EmailWaterfallResult {
  // Recheck historical step strings too: a cached success may predate domain matching.
  const attempts = Object.fromEntries(
    EMAIL_SOURCE_FIELDS.filter((field) => field in row).map((field) => {
      const email = validEmailCandidate(row[field]);
      return [
        field,
        email ? (emailDomainMismatch(email, row.domain) ?? email) : row[field],
      ];
    }),
  );
  for (const field of EMAIL_SOURCE_FIELDS) {
    const value = validEmailCandidate(attempts[field]);
    if (value !== null) {
      return {
        email: value,
        source: field,
        validated: true,
        attempts,
        waterfall_attempts: attempts,
      };
    }
  }
  return {
    email: null,
    source: null,
    validated: false,
    attempts,
    waterfall_attempts: attempts,
  };
}

function emailResultFromPersonEmailState(
  row: PersonEmailState,
): EmailWaterfallResult {
  return nextEmailFromPersonEmailState(row);
}

export function emailResultField(
  row: Record<string, unknown>,
  field: 'email' | 'source' | 'validated',
): string | boolean | null {
  const result = row.email_result;
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const value = (result as Record<string, unknown>)[field];
  if (field === 'validated') return value === true;
  return stringOrNull(value);
}

export function emailResultAttempts(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const result = row.email_result;
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return {};
  }
  const attempts = (result as Record<string, unknown>).attempts;
  return attempts !== null &&
    typeof attempts === 'object' &&
    !Array.isArray(attempts)
    ? (attempts as Record<string, unknown>)
    : {};
}

export function emailResultWaterfallAttempts(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return emailResultAttempts(row);
}

type ValidationStatusResult = ToolExecuteResult<unknown>;

type SafeToolExecutionRequest = {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  description?: string;
  force?: boolean;
  staleAfterSeconds?: number;
  timeoutMs?: number;
  receiptWaitMs?: number;
};

type EmailWaterfallStepContext = {
  tools: {
    execute(request: SafeToolExecutionRequest): Promise<ValidationStatusResult>;
  };
};
type EmailCandidate = {
  email?: unknown;
  type?: unknown;
  isVerified?: unknown;
};

function isEmailCandidate(value: unknown): value is EmailCandidate {
  return value !== null && typeof value === 'object';
}

function isWorkEmailCandidate(value: unknown): value is EmailCandidate {
  return isEmailCandidate(value) && value.type === 'work';
}

// This module is compiled into an inline prebuilt handler, whose runtime
// import boundary permits only `deepline`. Keep this small provider-label
// normalization local rather than importing a shared helper.
function normalizedEmailValidationStatus(value: string | null): string | null {
  const status = value?.trim().toLowerCase();
  if (!status) return null;
  switch (status) {
    case 'deliverable':
      return 'valid';
    case 'undeliverable':
      return 'invalid';
    case 'risky':
      return 'unknown';
    default:
      return status;
  }
}

function validationStatus(execution: ValidationStatusResult): string {
  const data =
    execution.toolResponse.raw != null &&
    typeof execution.toolResponse.raw === 'object' &&
    !Array.isArray(execution.toolResponse.raw)
      ? (execution.toolResponse.raw as Record<string, unknown>)
      : {};
  const readStatus = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return (
        stringOrNull(record.status) ??
        stringOrNull(record.verdict) ??
        (record.verified === true ? 'valid' : null)
      );
    }
    return null;
  };
  const nestedData =
    data.data && typeof data.data === 'object' && !Array.isArray(data.data)
      ? (data.data as Record<string, unknown>)
      : {};
  return (
    normalizedEmailValidationStatus(
      readStatus(execution.extractedValues?.email_status?.get()) ??
        readStatus(execution.extractedValues?.status?.get()) ??
        readStatus(data.email_status) ??
        readStatus(data.status) ??
        readStatus(data.result) ??
        readStatus(nestedData.email_status) ??
        readStatus(nestedData.result),
    ) ?? ''
  );
}

// A finder (or a generated pattern guess) produced a candidate, and the
// zerobounce_validate call that ran afterward (and billed) rejected
// it. Distinct from a bare `null` (no candidate at all, or step skipped) so
// waterfall_attempts shows what a charged validation call actually returned.
function emailValidationRejected(
  candidate: string,
  status: string,
): Record<string, unknown> {
  return {
    outcome: 'validation_rejected',
    candidate_email: candidate,
    validation_status: status || null,
  };
}

// The provider's own finder call completed but returned nothing usable.
// Distinct from a bare `null`, which also means "skipped by runIf and never
// called." Only used after a real tool call, never before one.
function noResultOutcome(): Record<string, unknown> {
  return { status: 'no_result', outcome: 'no_result' };
}

// Mailbox validity does not establish that an address belongs to the requested
// company. Require the normalized domain exactly; aliases need independent
// evidence and must never be inferred from a provider's email alone.
function emailDomainMismatch(
  candidate: string,
  expectedDomain: unknown,
): Record<string, unknown> | null {
  const expected = normalizeDomain(expectedDomain);
  const returned = candidate.split('@')[1]?.toLowerCase() ?? '';
  if (returned === expected) return null;
  return {
    outcome: 'domain_mismatch',
    candidate_email: candidate,
    expected_domain: expected,
    returned_domain: returned,
  };
}

function validatedEmail(
  raw: ValidationStatusResult,
  candidate: string,
  expectedDomain: string,
): string | Record<string, unknown> {
  const status = validationStatus(raw);
  if (status !== 'valid') return emailValidationRejected(candidate, status);
  const email = stringOrNull(raw.extractedValues?.email?.get()) ?? candidate;
  return emailDomainMismatch(email, expectedDomain) ?? email;
}

function validEmailCandidate(candidate: unknown): string | null {
  const email = stringOrNull(candidate);
  if (!email || !isLikelyEmail(email)) return null;
  return email;
}

function noValidEmailCandidate(
  candidate: unknown,
  expectedDomain: unknown,
): boolean {
  const email = validEmailCandidate(candidate);
  return email === null || emailDomainMismatch(email, expectedDomain) !== null;
}

function generatedEmail(parts: string[], domain: string): string | null {
  const local = parts.join('');
  if (!local || !isLikelyDomain(domain)) return null;
  const email = `${local}@${normalizeDomain(domain)}`;
  return isLikelyEmail(email) ? email : null;
}

function providerReady(row: PersonEmailState): boolean {
  const input = normalizePersonEmailInput(row);
  return Boolean(
    emailLocalName(input.first_name).length >= 2 &&
    emailLocalName(input.last_name).length >= 2 &&
    input.domain &&
    isLikelyDomain(input.domain),
  );
}

/**
 * Local mirror of Hunter's `parseHunterPersonName` contract.
 *
 * This inline prebuilt handler cannot import integration implementation values,
 * so keep the grammar and minimum-letter rule in sync with
 * `apps/deepline-api/src/lib/integrations/hunter/models_typebox.ts`.
 */
function hunterPersonNameReady(value: unknown): boolean {
  const name = trimmedString(value);
  if (!/^[\p{L}][\p{L}\s.''-]*$/u.test(name)) return false;
  return name.replace(/[^\p{L}]/gu, '').length >= 2;
}

function hunterReady(row: PersonEmailState): boolean {
  const input = normalizePersonEmailInput(row);
  return (
    providerReady(input) &&
    hunterPersonNameReady(input.first_name) &&
    hunterPersonNameReady(input.last_name)
  );
}

// ---------------------------------------------------------------------------
// API provider waterfall order (empirically tuned on 40 contacts, 2026-05-29)
// Ordered by verified-email quality; all pay-per-success so misses are free.
// hunter     $0.0100/call, ~49% hit, 76% valid  → cheapest $/valid ($0.026); goes first
// leadmagic  $0.0125/call, ~43% hit, 88% valid  → $0.032/valid; broad coverage
// datagma    $0.0140/call, ~26% hit, 89% valid  → $0.056/valid; strong EU/international
// findymail  $0.0198/call, ~55% hit, ~85% valid → strong on EU/SMB domains; pay-per-success
// icypeas    $0.0190/call, 52% hit, 100% valid  → zero false positives
// prospeo    $0.0390/call, 34% hit, 80% valid   → LinkedIn-anchored; strong prospeo fallback
// native     $0.0980/call, ~8% hit, 90% valid   → Deepline internal cache; catches obscure/internal domains
// fullenrich $0.0550/call, 75% hit, 90% valid   → deep async waterfall, penultimate fallback
// lusha      $0.0700/call, ~35% hit, 100% valid → LinkedIn+name+domain; 100% valid rate in benchmark
// contactout $0.1400/call, ~40% hit, 85% valid  → LinkedIn-anchored, expensive, last resort
// NOTE: zerobounce_email_finder ($0.546/result) excluded — too expensive for waterfall
// ---------------------------------------------------------------------------

type EmailWaterfallStepDescriptor = {
  name: (typeof EMAIL_SOURCE_FIELDS)[number];
  run: (
    ctx: EmailWaterfallStepContext,
    row: PersonEmailState,
  ) => Promise<unknown>;
  runIf?: (row: PersonEmailState) => boolean;
};

/**
 * Delegate to the shared attempt builder.
 *
 * This was a byte-for-byte reimplementation of `unavailableWaterfallAttempt`,
 * so every field added there silently skipped this waterfall. Keep one
 * implementation.
 */
/** Local mirror of `FAILURE_EXPLANATIONS` in `./waterfall-attempts`. */
const FAILURE_EXPLANATIONS: Record<string, string> = {
  UPSTREAM_BAD_INPUT:
    'The provider rejected the request payload as invalid. The same payload will fail again; the request needs fixing, not retrying.',
  UPSTREAM_NOT_FOUND:
    'The provider had no record for this identifier. This is a miss, not an outage.',
  PROVIDER_ACCOUNT_CAPACITY:
    'The provider account is out of capacity (credits or plan limit). The provider is reachable.',
  INTEGRATION_CREDENTIALS_MISSING:
    'No credentials are configured for this provider, so the call was never attempted.',
};

/**
 * Local mirror of `unavailableWaterfallAttempt` from `./waterfall-attempts`.
 *
 * Do NOT collapse this into an import. This file hosts an inline prebuilt
 * handler, and the extractor in `registry.ts` requires every value import in
 * such a file to come from `deepline`; a relative import fails the build with
 * "unsupported runtime import from deepline". The duplication is the cost of
 * the handler being self-contained. Keep the two in sync by hand — a field
 * added there and not here silently skips this waterfall.
 */
function providerUnavailableOutcome(error: unknown): Record<string, unknown> {
  const details =
    error !== null && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : {};
  const optionalString = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value : null;
  const optionalNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const code = optionalString(details.code);

  return {
    status: 'unavailable',
    outcome: 'provider_unavailable',
    provider:
      optionalString(details.provider) ?? optionalString(details.toolId),
    operation: optionalString(details.operation),
    code,
    category: optionalString(details.category),
    retryable: details.retryable === true,
    status_code: optionalNumber(details.statusCode),
    request_id: optionalString(details.requestId),
    retry_after_ms: optionalNumber(details.retryAfterMs),
    network_kind: optionalString(details.networkKind),
    network_scope: optionalString(details.networkScope),
    explanation: code ? (FAILURE_EXPLANATIONS[code] ?? null) : null,
  };
}

async function runEmailWaterfallStep(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
  run: EmailWaterfallStepDescriptor['run'],
): Promise<unknown> {
  try {
    return await run(ctx, row);
  } catch (error: unknown) {
    if (isProviderUnavailable(error)) return providerUnavailableOutcome(error);
    throw error;
  }
}

async function runPatternFirstAt(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const candidate = generatedEmail(
    [emailLocalName(input.first_name)],
    input.domain,
  );
  if (!candidate) return null;
  const raw = await ctx.tools.execute({
    id: 'pattern_first_at',
    tool: 'zerobounce_validate',
    description: 'pattern_first_at',
    input: { email: candidate },
  });
  return validatedEmail(raw, candidate, input.domain);
}

async function runPatternFlast(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const first = emailLocalName(input.first_name);
  const last = emailLocalName(input.last_name);
  const candidate = generatedEmail([first.slice(0, 1), last], input.domain);
  if (!candidate) return null;
  const raw = await ctx.tools.execute({
    id: 'pattern_flast',
    tool: 'zerobounce_validate',
    description: 'pattern_flast',
    input: { email: candidate },
  });
  return validatedEmail(raw, candidate, input.domain);
}

async function runPatternFirstDotLast(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const first = emailLocalName(input.first_name);
  const last = emailLocalName(input.last_name);
  const candidate = generatedEmail([first, '.', last], input.domain);
  if (!candidate) return null;
  const raw = await ctx.tools.execute({
    id: 'pattern_first_dot_last',
    tool: 'zerobounce_validate',
    description: 'pattern_first_dot_last',
    input: { email: candidate },
  });
  return validatedEmail(raw, candidate, input.domain);
}

async function runPatternFirstl(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const first = emailLocalName(input.first_name);
  const last = emailLocalName(input.last_name);
  const candidate = generatedEmail([first, last.slice(0, 1)], input.domain);
  if (!candidate) return null;
  const raw = await ctx.tools.execute({
    id: 'pattern_firstl',
    tool: 'zerobounce_validate',
    description: 'pattern_firstl',
    input: { email: candidate },
  });
  return validatedEmail(raw, candidate, input.domain);
}

async function runPatternFirstlast(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const first = emailLocalName(input.first_name);
  const last = emailLocalName(input.last_name);
  const candidate = generatedEmail([first, last], input.domain);
  if (!candidate) return null;
  const raw = await ctx.tools.execute({
    id: 'pattern_firstlast',
    tool: 'zerobounce_validate',
    description: 'pattern_firstlast',
    input: { email: candidate },
  });
  return validatedEmail(raw, candidate, input.domain);
}

async function runHunterEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'hunter_email',
    tool: 'hunter_email_finder',
    description: 'hunter_email',
    input: {
      first_name: input.first_name,
      last_name: input.last_name,
      domain: input.domain,
    },
  });
  const candidate = validEmailCandidate(raw.extractedValues.email?.get());
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'hunter_email_validation',
    tool: 'zerobounce_validate',
    description: 'hunter_email_validation',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

async function runLeadmagicEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'leadmagic_email',
    tool: 'leadmagic_email_finder',
    description: 'leadmagic_email',
    input: {
      first_name: input.first_name,
      last_name: input.last_name,
      domain: input.domain,
      company_domain: input.domain,
    },
  });
  const candidate = validEmailCandidate(raw.extractedValues.email?.get());
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'leadmagic_email_validation_after_finder',
    tool: 'zerobounce_validate',
    description: 'leadmagic_email_validation_after_finder',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

async function runDatagmaEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'datagma_email',
    tool: 'datagma_find_email',
    description: 'datagma_email',
    input: {
      firstName: input.first_name,
      lastName: input.last_name,
      companyDomain: input.domain,
      ...(input.company_name ? { companyName: input.company_name } : {}),
    },
  });
  const ev = raw.extractedValues as Record<
    string,
    { get(): unknown } | undefined
  >;
  const status = validationStatus(raw);
  const rawCandidate = validEmailCandidate(ev['email']?.get());
  // Use the integration's normalized verdict, including upstream "verified".
  if (status && status !== 'valid' && !status.startsWith('valid')) {
    return rawCandidate
      ? emailValidationRejected(rawCandidate, status)
      : noResultOutcome();
  }
  const candidate = rawCandidate;
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'datagma_email_validation',
    tool: 'zerobounce_validate',
    description: 'datagma_email_validation',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

async function runFindymailEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'findymail_email',
    tool: 'findymail_find_from_name',
    description: 'findymail_email',
    input: {
      name: `${input.first_name} ${input.last_name}`,
      domain: input.domain,
    },
  });
  // findymail result path: result.data.contact.email
  const ev = raw.extractedValues as Record<
    string,
    { get(): unknown } | undefined
  >;
  const candidate = validEmailCandidate(ev['email']?.get());
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'findymail_email_validation',
    tool: 'zerobounce_validate',
    description: 'findymail_email_validation',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

async function runIcypeasEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'icypeas_email',
    tool: 'icypeas_email_search',
    description: 'icypeas_email',
    input: {
      firstname: input.first_name,
      lastname: input.last_name,
      domainOrCompany: input.domain,
    },
  });
  const candidate = validEmailCandidate(raw.extractedValues.email?.get());
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'icypeas_email_validation',
    tool: 'zerobounce_validate',
    description: 'icypeas_email_validation',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

async function runProspeoVerifiedEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'prospeo_verified_email',
    tool: 'prospeo_enrich_person',
    description: 'prospeo_verified_email',
    input: {
      first_name: input.first_name,
      last_name: input.last_name,
      ...(input.linkedin_url
        ? { linkedin_url: input.linkedin_url }
        : { company_website: input.domain }),
      only_verified_email: true,
    },
  });
  const candidate = validEmailCandidate(raw.extractedValues.email?.get());
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'prospeo_email_validation',
    tool: 'zerobounce_validate',
    description: 'prospeo_email_validation',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

async function runPdlEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'pdl_email',
    tool: 'peopledatalabs_enrich_contact',
    description:
      'Find a work email with PDL; require work_email for a billable match.',
    input: {
      first_name: input.first_name,
      last_name: input.last_name,
      domain: input.domain,
      required: 'work_email',
      min_likelihood: 6,
    },
  });
  const candidate = validEmailCandidate(raw.extractedValues.email?.get());
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'pdl_email_validation',
    tool: 'zerobounce_validate',
    description: 'Validate the work email returned by PDL.',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

async function runNativeEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'native_email',
    tool: 'deepline_native_enrich_contact',
    description: 'native_email',
    input: {
      first_name: input.first_name,
      last_name: input.last_name,
      domain: input.domain,
      ...(input.linkedin_url ? { linkedin: input.linkedin_url } : {}),
    },
  });
  const candidate = validEmailCandidate(raw.extractedValues['email']?.get());
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'native_email_validation',
    tool: 'zerobounce_validate',
    description: 'native_email_validation',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

async function runFullenrichEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'fullenrich_email',
    tool: 'fullenrich_bulk_enrich',
    description: 'fullenrich_email',
    input: {
      name: `wf-${input.first_name}-${input.last_name}`,
      data: [
        {
          first_name: input.first_name,
          last_name: input.last_name,
          domain: input.domain,
          enrich_fields: ['contact.emails'],
          ...(input.linkedin_url ? { linkedin_url: input.linkedin_url } : {}),
        },
      ],
    },
  });
  const ev = raw.extractedValues as Record<
    string,
    { get(): unknown } | undefined
  >;
  const candidate = validEmailCandidate(ev['email']?.get());
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'fullenrich_email_validation',
    tool: 'zerobounce_validate',
    description: 'fullenrich_email_validation',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

async function runLushaEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'lusha_email',
    tool: 'lusha_enrich_person',
    description: 'lusha_email',
    input: {
      first_name: input.first_name,
      last_name: input.last_name,
      company_domain: input.domain,
      ...(input.linkedin_url ? { linkedin_url: input.linkedin_url } : {}),
      reveal_emails: true,
      reveal_phones: false,
    },
  });
  const ev = raw.extractedValues as Record<
    string,
    { get(): unknown } | undefined
  >;
  // Prefer verified work email
  const emails = ev['emails']?.get();
  if (Array.isArray(emails)) {
    const workVerified = emails.find(
      (email) => isWorkEmailCandidate(email) && Boolean(email.isVerified),
    );
    const workAny = emails.find(isWorkEmailCandidate);
    const best = workVerified ?? workAny;
    const candidate = validEmailCandidate(best?.email);
    if (candidate) {
      const mismatch = emailDomainMismatch(candidate, input.domain);
      if (mismatch) return mismatch;
      const validation = await ctx.tools.execute({
        id: 'lusha_email_validation',
        tool: 'zerobounce_validate',
        description: 'lusha_email_validation',
        input: { email: candidate },
      });
      return validatedEmail(validation, candidate, input.domain);
    }
  }
  const candidate = validEmailCandidate(ev['email']?.get());
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'lusha_email_validation',
    tool: 'zerobounce_validate',
    description: 'lusha_email_validation',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

async function runContactoutEmail(
  ctx: EmailWaterfallStepContext,
  row: PersonEmailState,
): Promise<unknown> {
  const input = normalizePersonEmailInput(row);
  const raw = await ctx.tools.execute({
    id: 'contactout_email',
    tool: 'contactout_enrich_person',
    description: 'contactout_email',
    input: {
      first_name: input.first_name,
      last_name: input.last_name,
      company_domain: input.domain,
      ...(input.linkedin_url ? { linkedin_url: input.linkedin_url } : {}),
      include: ['work_email'],
    },
  });
  const ev = raw.extractedValues as Record<
    string,
    { get(): unknown } | undefined
  >;
  const workEmail = ev['work_email']?.get();
  const workEmailCandidate = validEmailCandidate(workEmail);
  if (workEmailCandidate) {
    const mismatch = emailDomainMismatch(workEmailCandidate, input.domain);
    if (mismatch) return mismatch;
    const validation = await ctx.tools.execute({
      id: 'contactout_email_validation',
      tool: 'zerobounce_validate',
      description: 'contactout_email_validation',
      input: { email: workEmailCandidate },
    });
    return validatedEmail(validation, workEmailCandidate, input.domain);
  }
  const emails = ev['emails']?.get();
  if (Array.isArray(emails)) {
    const work = emails.find(isWorkEmailCandidate);
    const workCandidate = validEmailCandidate(work?.email);
    if (workCandidate) {
      const mismatch = emailDomainMismatch(workCandidate, input.domain);
      if (mismatch) return mismatch;
      const validation = await ctx.tools.execute({
        id: 'contactout_email_validation',
        tool: 'zerobounce_validate',
        description: 'contactout_email_validation',
        input: { email: workCandidate },
      });
      return validatedEmail(validation, workCandidate, input.domain);
    }
    const firstCandidate = validEmailCandidate(
      typeof emails[0] === 'string'
        ? emails[0]
        : isEmailCandidate(emails[0])
          ? emails[0].email
          : null,
    );
    if (firstCandidate) {
      const mismatch = emailDomainMismatch(firstCandidate, input.domain);
      if (mismatch) return mismatch;
      const validation = await ctx.tools.execute({
        id: 'contactout_email_validation',
        tool: 'zerobounce_validate',
        description: 'contactout_email_validation',
        input: { email: firstCandidate },
      });
      return validatedEmail(validation, firstCandidate, input.domain);
    }
  }
  const candidate = validEmailCandidate(ev['email']?.get());
  if (!candidate) return noResultOutcome();
  const mismatch = emailDomainMismatch(candidate, input.domain);
  if (mismatch) return mismatch;
  const validation = await ctx.tools.execute({
    id: 'contactout_email_validation',
    tool: 'zerobounce_validate',
    description: 'contactout_email_validation',
    input: { email: candidate },
  });
  return validatedEmail(validation, candidate, input.domain);
}

const PERSON_TO_EMAIL_STEP_DESCRIPTORS: readonly EmailWaterfallStepDescriptor[] =
  [
    {
      name: 'pattern_first_at',
      run: runPatternFirstAt,
    },
    {
      name: 'pattern_flast',
      run: runPatternFlast,
      runIf: (row: PersonEmailState) =>
        noValidEmailCandidate(row.pattern_first_at, row.domain),
    },
    {
      name: 'pattern_first_dot_last',
      run: runPatternFirstDotLast,
      runIf: (row: PersonEmailState) =>
        noValidEmailCandidate(row.pattern_first_at, row.domain) &&
        noValidEmailCandidate(row.pattern_flast, row.domain),
    },
    {
      name: 'pattern_firstl',
      run: runPatternFirstl,
      runIf: (row: PersonEmailState) =>
        noValidEmailCandidate(row.pattern_first_at, row.domain) &&
        noValidEmailCandidate(row.pattern_flast, row.domain) &&
        noValidEmailCandidate(row.pattern_first_dot_last, row.domain),
    },
    {
      name: 'pattern_firstlast',
      run: runPatternFirstlast,
      runIf: (row: PersonEmailState) =>
        providerReady(row) &&
        noValidEmailCandidate(row.pattern_first_at, row.domain) &&
        noValidEmailCandidate(row.pattern_flast, row.domain) &&
        noValidEmailCandidate(row.pattern_first_dot_last, row.domain) &&
        noValidEmailCandidate(row.pattern_firstl, row.domain),
    },
    {
      name: 'hunter_email',
      run: runHunterEmail,
      runIf: (row: PersonEmailState) =>
        hunterReady(row) &&
        noValidEmailCandidate(row.pattern_first_at, row.domain) &&
        noValidEmailCandidate(row.pattern_flast, row.domain) &&
        noValidEmailCandidate(row.pattern_first_dot_last, row.domain) &&
        noValidEmailCandidate(row.pattern_firstl, row.domain) &&
        noValidEmailCandidate(row.pattern_firstlast, row.domain),
    },
    {
      name: 'leadmagic_email',
      run: runLeadmagicEmail,
      runIf: (row: PersonEmailState) =>
        providerReady(row) &&
        noValidEmailCandidate(row.pattern_first_at, row.domain) &&
        noValidEmailCandidate(row.pattern_flast, row.domain) &&
        noValidEmailCandidate(row.pattern_first_dot_last, row.domain) &&
        noValidEmailCandidate(row.pattern_firstl, row.domain) &&
        noValidEmailCandidate(row.pattern_firstlast, row.domain) &&
        noValidEmailCandidate(row.hunter_email, row.domain),
    },
    {
      name: 'datagma_email',
      run: runDatagmaEmail,
      runIf: (row: PersonEmailState) =>
        providerReady(row) &&
        noValidEmailCandidate(row.pattern_first_at, row.domain) &&
        noValidEmailCandidate(row.pattern_flast, row.domain) &&
        noValidEmailCandidate(row.pattern_first_dot_last, row.domain) &&
        noValidEmailCandidate(row.pattern_firstl, row.domain) &&
        noValidEmailCandidate(row.pattern_firstlast, row.domain) &&
        noValidEmailCandidate(row.hunter_email, row.domain) &&
        noValidEmailCandidate(row.leadmagic_email, row.domain),
    },
    {
      name: 'findymail_email',
      run: runFindymailEmail,
      runIf: (row: PersonEmailState) =>
        providerReady(row) &&
        noValidEmailCandidate(row.pattern_first_at, row.domain) &&
        noValidEmailCandidate(row.pattern_flast, row.domain) &&
        noValidEmailCandidate(row.pattern_first_dot_last, row.domain) &&
        noValidEmailCandidate(row.pattern_firstl, row.domain) &&
        noValidEmailCandidate(row.pattern_firstlast, row.domain) &&
        noValidEmailCandidate(row.hunter_email, row.domain) &&
        noValidEmailCandidate(row.leadmagic_email, row.domain) &&
        noValidEmailCandidate(row.datagma_email, row.domain),
    },
    {
      name: 'icypeas_email',
      run: runIcypeasEmail,
      runIf: (row: PersonEmailState) =>
        providerReady(row) &&
        noValidEmailCandidate(row.pattern_first_at, row.domain) &&
        noValidEmailCandidate(row.pattern_flast, row.domain) &&
        noValidEmailCandidate(row.pattern_first_dot_last, row.domain) &&
        noValidEmailCandidate(row.pattern_firstl, row.domain) &&
        noValidEmailCandidate(row.pattern_firstlast, row.domain) &&
        noValidEmailCandidate(row.hunter_email, row.domain) &&
        noValidEmailCandidate(row.leadmagic_email, row.domain) &&
        noValidEmailCandidate(row.datagma_email, row.domain) &&
        noValidEmailCandidate(row.findymail_email, row.domain),
    },
    {
      name: 'prospeo_verified_email',
      run: runProspeoVerifiedEmail,
      runIf: (row: PersonEmailState) =>
        providerReady(row) &&
        noValidEmailCandidate(row.pattern_first_at, row.domain) &&
        noValidEmailCandidate(row.pattern_flast, row.domain) &&
        noValidEmailCandidate(row.pattern_first_dot_last, row.domain) &&
        noValidEmailCandidate(row.pattern_firstl, row.domain) &&
        noValidEmailCandidate(row.pattern_firstlast, row.domain) &&
        noValidEmailCandidate(row.hunter_email, row.domain) &&
        noValidEmailCandidate(row.leadmagic_email, row.domain) &&
        noValidEmailCandidate(row.datagma_email, row.domain) &&
        noValidEmailCandidate(row.findymail_email, row.domain) &&
        noValidEmailCandidate(row.icypeas_email, row.domain),
    },
    {
      name: 'native_email',
      run: runNativeEmail,
      runIf: () => false,
    },
    {
      name: 'fullenrich_email',
      run: runFullenrichEmail,
      runIf: () => false,
    },
    {
      name: 'lusha_email',
      run: runLushaEmail,
      runIf: () => false,
    },
    {
      name: 'contactout_email',
      run: runContactoutEmail,
      runIf: () => false,
    },
    {
      name: 'pdl_email',
      run: runPdlEmail,
      runIf: (row: PersonEmailState) =>
        providerReady(row) && emailFromPersonEmailState(row) === null,
    },
  ] as const;

function personEmailStepRunIf(
  name: (typeof EMAIL_SOURCE_FIELDS)[number],
): (row: PersonEmailState) => boolean {
  const descriptor = PERSON_TO_EMAIL_STEP_DESCRIPTORS.find(
    (candidate) => candidate.name === name,
  );
  return (row) => descriptor?.runIf?.(row) ?? true;
}

export function personToEmailSteps<T extends PersonEmailWaterfallInput>() {
  // Keep the program statically visible so preflight, share pages, and sheet
  // contracts retain the real provider waterfall. Each leg handles an
  // unavailable provider itself, so ordinary errors still fail the run.
  return steps<T>()
    .step(
      'pattern_first_at',
      async (row, ctx) => {
        try {
          return await runPatternFirstAt(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: () => true,
      },
    )
    .step(
      'pattern_flast',
      async (row, ctx) => {
        try {
          return await runPatternFlast(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: personEmailStepRunIf('pattern_flast'),
      },
    )
    .step(
      'pattern_first_dot_last',
      async (row, ctx) => {
        try {
          return await runPatternFirstDotLast(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      { runIf: personEmailStepRunIf('pattern_first_dot_last') },
    )
    .step(
      'pattern_firstl',
      async (row, ctx) => {
        try {
          return await runPatternFirstl(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: personEmailStepRunIf('pattern_firstl'),
      },
    )
    .step(
      'pattern_firstlast',
      async (row, ctx) => {
        try {
          return await runPatternFirstlast(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: personEmailStepRunIf('pattern_firstlast'),
      },
    )
    .step(
      'hunter_email',
      async (row, ctx) => {
        try {
          return await runHunterEmail(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: personEmailStepRunIf('hunter_email'),
      },
    )
    .step(
      'leadmagic_email',
      async (row, ctx) => {
        try {
          return await runLeadmagicEmail(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: personEmailStepRunIf('leadmagic_email'),
      },
    )
    .step(
      'datagma_email',
      async (row, ctx) => {
        try {
          return await runDatagmaEmail(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: personEmailStepRunIf('datagma_email'),
      },
    )
    .step(
      'findymail_email',
      async (row, ctx) => {
        try {
          return await runFindymailEmail(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: personEmailStepRunIf('findymail_email'),
      },
    )
    .step(
      'icypeas_email',
      async (row, ctx) => {
        try {
          return await runIcypeasEmail(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: personEmailStepRunIf('icypeas_email'),
      },
    )
    .step(
      'prospeo_verified_email',
      async (row, ctx) => {
        try {
          return await runProspeoVerifiedEmail(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      { runIf: personEmailStepRunIf('prospeo_verified_email') },
    )
    .step(
      'native_email',
      async (row, ctx) => {
        try {
          return await runNativeEmail(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: () => false,
      },
    )
    .step(
      'fullenrich_email',
      async (row, ctx) => {
        try {
          return await runFullenrichEmail(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: () => false,
      },
    )
    .step(
      'lusha_email',
      async (row, ctx) => {
        try {
          return await runLushaEmail(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: () => false,
      },
    )
    .step(
      'contactout_email',
      async (row, ctx) => {
        try {
          return await runContactoutEmail(ctx, row);
        } catch (error) {
          if (isProviderUnavailable(error))
            return providerUnavailableOutcome(error);
          throw error;
        }
      },
      {
        runIf: () => false,
      },
    )
    .step(
      'pdl_email',
      async (row, ctx) => runEmailWaterfallStep(ctx, row, runPdlEmail),
      { runIf: personEmailStepRunIf('pdl_email') },
    )
    .return((row) => emailResultFromPersonEmailState(row));
}

/** Execute one independent waterfall with ordinary TypeScript control flow. */
export async function runPersonToEmailWaterfall(
  ctx: DeeplinePlayRuntimeContext,
  input: PersonEmailWaterfallInput,
): Promise<EmailWaterfallResult> {
  const row: PersonEmailState = { ...input };
  for (const descriptor of PERSON_TO_EMAIL_STEP_DESCRIPTORS) {
    row[descriptor.name] =
      !descriptor.runIf || descriptor.runIf(row)
        ? await runEmailWaterfallStep(ctx, row, descriptor.run)
        : null;
  }
  return emailResultFromPersonEmailState(row);
}

/** @deprecated Use runPersonToEmailWaterfall. */
export const runPersonToEmailWaterfallImperatively = runPersonToEmailWaterfall;

/**
 * Resolve one work email from first name, last name, and domain.
 * Waterfall: patterns → hunter → leadmagic → datagma → findymail → icypeas → prospeo → deepline_native → fullenrich → lusha → contactout → PDL (work email required).
 */
export async function nameAndDomainToEmailWaterfallHandler(
  ctx: DeeplinePlayRuntimeContext,
  input: {
    first_name: string;
    last_name: string;
    domain: string;
    company_name?: string;
    linkedin_url?: string;
  },
): Promise<{
  email: string | null;
  email_source: string | null;
  email_validated: boolean;
  email_attempts: Record<string, unknown>;
  waterfall_attempts: Record<string, unknown>;
}> {
  const result = await ctx.runSteps(personToEmailSteps<typeof input>(), input);
  return {
    email: result.email,
    email_source: result.source,
    email_validated: result.validated,
    email_attempts: result.attempts,
    waterfall_attempts: result.waterfall_attempts,
  };
}
