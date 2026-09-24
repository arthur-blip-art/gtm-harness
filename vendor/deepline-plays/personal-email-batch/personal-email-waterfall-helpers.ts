export type PersonalEmailSourceField =
  | 'contactout_personal'
  | 'aviato_personal'
  | 'limadata_personal'
  | 'leadmagic_personal'
  | 'wiza_personal'
  | 'icypeas_personal'
  | 'forager_personal'
  | 'datagma_personal'
  | 'pdl_personal';

export const PERSONAL_EMAIL_SOURCE_FIELDS: readonly PersonalEmailSourceField[] =
  [
    'contactout_personal',
    'aviato_personal',
    'limadata_personal',
    'leadmagic_personal',
    'wiza_personal',
    'icypeas_personal',
    'forager_personal',
    'datagma_personal',
    'pdl_personal',
  ];

export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    const normalized = stringOrNull(entry);
    if (normalized) return normalized;
  }
  return null;
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

export function validPersonalEmail(value: unknown): string | null {
  const email = Array.isArray(value) ? firstString(value) : stringOrNull(value);
  return email && isLikelyEmail(email) ? email : null;
}

export function priorPersonalEmailSourceFields(
  source: PersonalEmailSourceField,
): readonly PersonalEmailSourceField[] {
  const prior: PersonalEmailSourceField[] = [];
  for (const field of PERSONAL_EMAIL_SOURCE_FIELDS) {
    if (field === source) {
      return prior;
    }
    prior.push(field);
  }
  throw new Error(`Unknown personal email source: ${source}`);
}

function rawToolPayload(value: unknown): unknown {
  const record = recordOrNull(value);
  const toolResponse = recordOrNull(record?.toolResponse);
  return toolResponse && 'raw' in toolResponse
    ? toolResponse.raw
    : (record?.raw ?? value);
}

function objectCandidates(value: unknown): Record<string, unknown>[] {
  const root = recordOrNull(value);
  if (!root) return [];
  const result = recordOrNull(root.result);
  return [root, root.result, root.data, result?.data]
    .flatMap((candidate) =>
      Array.isArray(candidate)
        ? candidate.map(recordOrNull)
        : [recordOrNull(candidate)],
    )
    .filter(
      (candidate): candidate is Record<string, unknown> => candidate != null,
    );
}

export function extractAviatoPersonalEmail(value: unknown): string | null {
  const raw = rawToolPayload(value);
  for (const candidate of objectCandidates(raw)) {
    const lookups = Array.isArray(candidate.lookups)
      ? candidate.lookups
      : Array.isArray(candidate.contacts)
        ? candidate.contacts
        : Array.isArray(candidate.results)
          ? candidate.results
          : [candidate];
    for (const lookup of lookups) {
      const lookupRecord = recordOrNull(lookup);
      const emails = Array.isArray(lookupRecord?.emails)
        ? lookupRecord.emails
        : Array.isArray(lookupRecord?.email_addresses)
          ? lookupRecord.email_addresses
          : [];
      for (const emailEntry of emails) {
        const emailRecord = recordOrNull(emailEntry);
        const type = stringOrNull(emailRecord?.type)?.toLowerCase();
        if (type !== 'personal') continue;
        const email = validPersonalEmail(
          emailRecord?.email ?? emailRecord?.value ?? emailRecord?.address,
        );
        if (email) return email;
      }
    }
  }
  return null;
}
