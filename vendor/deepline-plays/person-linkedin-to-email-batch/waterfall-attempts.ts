type ProviderUnavailableErrorShape = {
  provider?: unknown;
  toolId?: unknown;
  operation?: unknown;
  code?: unknown;
  category?: unknown;
  statusCode?: unknown;
  retryable?: unknown;
  retryAfterMs?: unknown;
  requestId?: unknown;
  networkKind?: unknown;
  networkScope?: unknown;
};

export type WaterfallUnavailableAttempt = {
  status: 'unavailable';
  outcome: 'provider_unavailable';
  provider: string | null;
  operation: string | null;
  code: string | null;
  category: string | null;
  status_code: number | null;
  retryable: boolean;
  retry_after_ms: number | null;
  request_id: string | null;
  network_kind: string | null;
  network_scope: string | null;
  /**
   * Plain-language explanation of the failure class, or `null` when the code
   * is not one we can describe.
   *
   * `outcome` stays `provider_unavailable` for every failure admitted here
   * because plays branch on it, but the label is too coarse to act on: a
   * provider that rejected our payload reads identically to one that was
   * down. This says which happened. It is drawn from Deepline's own failure
   * taxonomy rather than the provider's error prose, so it stays stable and
   * carries nothing the provider wrote.
   */
  explanation: string | null;
};

/**
 * Curated wording per failure code.
 *
 * Keep these provider-agnostic and free of provider prose. A code that is not
 * listed yields `null`, which is honest, rather than a vague sentence that
 * reads like an explanation without being one.
 */
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

function explanationForCode(code: string | null): string | null {
  if (!code) return null;
  return FAILURE_EXPLANATIONS[code] ?? null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Convert provider-specific email-validation labels to the waterfall's
 * canonical statuses. Generated tool extraction normally performs this
 * projection, but plays must also tolerate a raw provider label.
 */
export function normalizedEmailValidationStatus(
  value: unknown,
): string | undefined {
  let raw: string | undefined;

  if (typeof value === 'string') {
    raw = value;
  } else if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const record = value as Record<string, unknown>;

    if (typeof record.status === 'string') {
      raw = record.status;
    } else if (typeof record.verdict === 'string') {
      raw = record.verdict;
    } else if (record.verified === true) {
      raw = 'valid';
    }
  }

  const status = raw?.trim().toLowerCase();
  if (!status) return undefined;

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

/**
 * A serializable stage value for an exhausted provider availability failure.
 *
 * Waterfall steps can return this instead of swallowing an unavailable
 * provider as `null`. Existing result selectors continue to treat it as a
 * miss, while the final attempt projection keeps the provider classification.
 */
export function unavailableWaterfallAttempt(
  error: unknown,
): WaterfallUnavailableAttempt {
  const details =
    error !== null && typeof error === 'object'
      ? (error as ProviderUnavailableErrorShape)
      : {};

  return {
    status: 'unavailable',
    outcome: 'provider_unavailable',
    provider:
      nullableString(details.provider) ?? nullableString(details.toolId),
    operation: nullableString(details.operation),
    code: nullableString(details.code),
    category: nullableString(details.category),
    status_code: nullableNumber(details.statusCode),
    retryable: details.retryable === true,
    retry_after_ms: nullableNumber(details.retryAfterMs),
    request_id: nullableString(details.requestId),
    network_kind: nullableString(details.networkKind),
    network_scope: nullableString(details.networkScope),
    explanation: explanationForCode(nullableString(details.code)),
  };
}

export function isUnavailableWaterfallAttempt(
  value: unknown,
): value is WaterfallUnavailableAttempt {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { status?: unknown }).status === 'unavailable'
  );
}

export type WaterfallNoResultAttempt = {
  status: 'no_result';
  outcome: 'no_result';
};

/**
 * A serializable stage value for "the provider ran and returned nothing" —
 * distinct from a bare `null`, which also means "this step was skipped by
 * runIf and never called." Use only after a real tool call completed with no
 * usable candidate; a `return null` before any tool call (e.g. insufficient
 * input to even attempt a lookup) should stay a bare `null`.
 */
export function noResultWaterfallAttempt(): WaterfallNoResultAttempt {
  return { status: 'no_result', outcome: 'no_result' };
}

export function isNoResultWaterfallAttempt(
  value: unknown,
): value is WaterfallNoResultAttempt {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { status?: unknown }).status === 'no_result'
  );
}

/**
 * Preserve every named waterfall stage in one public, scalar-safe map.
 *
 * A normal miss remains `null`; an unavailable provider retains its typed
 * marker. Runtime step receipts remain the authority for whether a null stage
 * was skipped by `runIf` or executed and found no data.
 */
export function waterfallAttempts(
  row: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}
