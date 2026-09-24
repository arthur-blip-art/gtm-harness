export type SmbBusinessEmailInput = Record<string, unknown> & {
  business_name: string;
  domain: string;
  city?: string;
  state?: string;
  country?: string;
};

export type BusinessEmailCandidate = {
  email: string;
  source: 'openmart';
  domain_association: 'supplied_domain_match' | 'off_domain';
  validation_status: string;
  provider_response?: unknown;
};

export type SmbBusinessEmailResult = {
  email: string | null;
  email_source: 'openmart' | null;
  candidates: BusinessEmailCandidate[];
  candidate_count: number;
  truncated: boolean;
  miss_reason: 'no_email_candidates' | 'no_verified_domain_email' | null;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeSmbBusinessEmailInput(
  input: SmbBusinessEmailInput,
): SmbBusinessEmailInput {
  const business_name = optionalText(input.business_name);
  const suppliedDomain = optionalText(input.domain);
  if (!business_name || !suppliedDomain) {
    throw new Error('business_name and domain are required.');
  }
  const invalidDomainMessage =
    'domain must be a business website domain or HTTP(S) URL.';
  let url: URL;
  try {
    url = new URL(
      suppliedDomain.includes('://')
        ? suppliedDomain
        : `https://${suppliedDomain}`,
    );
  } catch (error) {
    if (error instanceof TypeError) throw new Error(invalidDomainMessage);
    throw error;
  }
  const domain = url.hostname.toLowerCase().replace(/^www\./, '');
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  ) {
    throw new Error('domain must be a business website domain or HTTP(S) URL.');
  }
  return {
    business_name,
    domain,
    city: optionalText(input.city),
    state: optionalText(input.state),
    country: optionalText(input.country),
  };
}

function emailValue(value: unknown): string | null {
  const email = optionalText(value)?.toLowerCase();
  return email && /^[^\s@<>]+@(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(email)
    ? email
    : null;
}

/** Read only documented email fields in completed task data, never arbitrary text. */
export function businessEmailCandidates(raw: unknown, domain: string) {
  const tasks = record(raw).results;
  if (!Array.isArray(tasks)) {
    throw new Error(
      'Business email lookup did not return completed task results.',
    );
  }
  const emails = new Set<string>();
  for (const task of tasks) {
    const data = record(task).data;
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    for (const value of rows) {
      const row = record(value);
      const fields = [
        row.email,
        record(row.email).email,
        ...(Array.isArray(row.emails) ? row.emails : []),
        ...(Array.isArray(row.business_emails) ? row.business_emails : []),
      ];
      for (const field of fields) {
        const email = emailValue(field);
        if (email) emails.add(email);
      }
    }
  }
  const matchesDomain = (email: string) => email.split('@')[1] === domain;
  const ordered = [...emails].sort(
    (a, b) =>
      Number(matchesDomain(b)) - Number(matchesDomain(a)) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  return {
    candidate_count: ordered.length,
    truncated: ordered.length > 3,
      candidates: ordered.slice(0, 3).map(
      (email): BusinessEmailCandidate => ({
        email,
        source: 'openmart',
        domain_association: matchesDomain(email)
          ? 'supplied_domain_match'
          : 'off_domain',
        validation_status: 'not_checked',
        provider_response: raw,
      }),
    ),
  };
}

export function businessEmailResult(
  discovery: ReturnType<typeof businessEmailCandidates>,
  candidates: BusinessEmailCandidate[],
): SmbBusinessEmailResult {
  const selected = candidates.find(
    (candidate) =>
      candidate.domain_association === 'supplied_domain_match' &&
      candidate.validation_status === 'valid',
  );
  return {
    email: selected?.email ?? null,
    email_source: selected ? 'openmart' : null,
    candidates,
    candidate_count: discovery.candidate_count,
    truncated: discovery.truncated,
    miss_reason: selected
      ? null
      : discovery.candidate_count === 0
        ? 'no_email_candidates'
        : 'no_verified_domain_email',
  };
}
