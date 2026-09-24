/** Deterministic matching and public projections; no residential addresses escape. */
export type EntityInput = Record<string, unknown> & {
  legal_name: string;
  state: string;
  city?: string;
  registry_number?: string;
};
export type ContactInput = Record<string, unknown> & {
  tahoe_id?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  state?: string;
  channels?: 'email' | 'mobile' | 'both';
};
export type Officer = {
  name: string;
  tahoe_id: string | null;
  recorded_role: string;
  relationship:
    | 'member_or_owner'
    | 'officer'
    | 'registered_agent'
    | 'entity'
    | 'unknown';
  eligible_for_contact: boolean;
  filing_id: string | null;
  reported_date: string | null;
};
export type EntityResult = {
  entity_match: 'matched' | 'ambiguous' | 'not_found';
  matched_entity: {
    legal_name: string;
    state: string;
    registry_number: string | null;
  } | null;
  owner_candidates: Officer[];
  held_relationships: Officer[];
  candidate_count: number;
  search_truncated: boolean;
  miss_reason: string | null;
};
export type Person = { name: string; tahoe_id: string | null };
export type PersonResult = {
  identity_match: 'exact_id' | 'review_required' | 'ambiguous' | 'not_found';
  person: Person | null;
  held_people: Person[];
  email_candidates: string[];
  mobile_candidates: string[];
  miss_reason: string | null;
};
export type ChannelResult = {
  value: string | null;
  validation_status: string;
  attempted_candidates: number;
};
export type ContactResult = {
  person: Person | null;
  identity_match: PersonResult['identity_match'];
  held_people: Person[];
  personal_email: ChannelResult;
  mobile: ChannelResult;
  miss_reason: string | null;
};
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}
export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function key(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}
export function providerData(result: {
  toolResponse?: { rawV2?: unknown; raw?: unknown; view?: string };
}): Record<string, unknown> {
  const response = result.toolResponse;
  if (response?.rawV2 !== undefined) {
    return object(
      response.view === 'data' ? object(response.rawV2).data : response.rawV2,
    );
  }
  return object(response?.raw);
}
export function normalizeEntityInput(input: EntityInput): EntityInput {
  const state = text(input.state).toUpperCase();
  const legal_name = text(input.legal_name);
  if (!legal_name || !/^[A-Z]{2}$/.test(state)) {
    throw new Error('Provide a legal_name and two-letter US state code.');
  }
  return {
    ...input,
    legal_name,
    state,
    city: text(input.city),
    registry_number: text(input.registry_number),
  };
}
const ACTIVE_FILING = /^(active|in existence|good standing|current)$/i;
const INACTIVE_OFFICER =
  /resigned|removed|inactive|former|terminated|deceased/i;
const ENTITY_NAME =
  /\b(llc|ltd|inc|corp|corporation|company|trust|holdings|partners|partnership|services|registered agents)\b/i;
function officerCandidate(
  officer: Record<string, unknown>,
  filing: Record<string, unknown>,
): Officer {
  const nameData = object(officer.name);
  const name =
    text(nameData.nameRaw) ||
    [nameData.nameFirst, nameData.nameMiddle, nameData.nameLast]
      .map(text)
      .filter(Boolean)
      .join(' ');
  const recorded_role = text(officer.title);
  const roles = recorded_role
    .toLowerCase()
    .split(/[,;/]+/)
    .map((value) => value.trim());
  const entity = ENTITY_NAME.test(name);
  const member = roles.some((role) =>
    /^(owner|member|managing member|managing-member)$/.test(role),
  );
  const officerRole = roles.some((role) =>
    /^(manager|president|vice president|secretary|treasurer|director|ceo|chief executive officer)$/.test(
      role,
    ),
  );
  const agent = roles.some((role) => /registered agent/.test(role));
  const relationship = entity
    ? 'entity'
    : member
      ? 'member_or_owner'
      : officerRole
        ? 'officer'
        : agent
          ? 'registered_agent'
          : 'unknown';
  const tahoe_id = text(nameData.tahoeId) || null;
  return {
    name,
    tahoe_id,
    recorded_role,
    relationship,
    eligible_for_contact: Boolean(
      tahoe_id &&
      !entity &&
      (member || officerRole) &&
      ACTIVE_FILING.test(text(filing.corpStatus)) &&
      !INACTIVE_OFFICER.test(text(officer.status)),
    ),
    filing_id: text(filing.corpFileKey) || text(filing.registryNumber) || null,
    reported_date:
      text(filing.lastReportedDate) || text(filing.fileDataDate) || null,
  };
}
export function resolveEntity(
  input: EntityInput,
  data: Record<string, unknown>,
): EntityResult {
  const normalized = normalizeEntityInput(input);
  const records = rows(data.businessV2Records);
  const filings = records
    .flatMap((record) => rows(record.usCorpFilings))
    .filter(
      (filing) =>
        [filing.name, filing.rawName].some(
          (name) => key(name) === key(normalized.legal_name),
        ) &&
        text(filing.stateCode).toUpperCase() === normalized.state &&
        (!normalized.registry_number ||
          text(filing.registryNumber) === normalized.registry_number) &&
        (!normalized.city ||
          rows(filing.corpMainAddresses).some(
            (address) =>
              key(address.city) === key(normalized.city) &&
              text(address.state).toUpperCase() === normalized.state,
          )),
    );
  const identities = new Set(
    filings.map(
      (filing) => text(filing.registryNumber) || text(filing.corpFileKey),
    ),
  );
  const truncated =
    records.length >= 10 || Number(object(data.pagination).totalPages ?? 1) > 1;
  const empty: EntityResult = {
    entity_match: 'not_found',
    matched_entity: null,
    owner_candidates: [],
    held_relationships: [],
    candidate_count: 0,
    search_truncated: truncated,
    miss_reason: 'no_exact_entity_match',
  };
  if (filings.length === 0) return empty;
  // Missing registration identifiers cannot establish that two filings belong to one entity.
  if (identities.size > 1 || (filings.length > 1 && identities.has('')))
    return {
      ...empty,
      entity_match: 'ambiguous',
      miss_reason: 'multiple_entity_matches',
    };
  const filing = filings[0]!;
  const candidates = filings
    .flatMap((item) =>
      rows(item.officers).map((officer) => officerCandidate(officer, item)),
    )
    .filter((officer) => officer.name);
  const unique = [
    ...new Map(
      candidates.map((candidate) => [JSON.stringify(candidate), candidate]),
    ).values(),
  ].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.recorded_role.localeCompare(b.recorded_role),
  );
  const people = unique.filter(
    (candidate) =>
      candidate.relationship === 'member_or_owner' ||
      candidate.relationship === 'officer',
  );
  const personIds = new Set(
    people.map((person) => person.tahoe_id || key(person.name)),
  );
  return {
    entity_match: 'matched',
    matched_entity: {
      legal_name: text(filing.rawName) || text(filing.name),
      state: normalized.state,
      registry_number: text(filing.registryNumber) || null,
    },
    owner_candidates: people.slice(0, 10),
    held_relationships: unique
      .filter((candidate) => !people.includes(candidate))
      .slice(0, 10),
    candidate_count: personIds.size,
    search_truncated:
      truncated || people.length > 10 || unique.length - people.length > 10,
    miss_reason: people.length ? null : 'no_person_officer_or_member',
  };
}
export function soleContactCandidate(result: EntityResult): Officer | null {
  if (
    result.entity_match !== 'matched' ||
    result.candidate_count !== 1 ||
    result.search_truncated
  )
    return null;
  const candidates = result.owner_candidates;
  return candidates.length > 0 &&
    candidates.every(
      (candidate) =>
        candidate.eligible_for_contact &&
        candidate.tahoe_id === candidates[0]!.tahoe_id,
    )
    ? candidates[0]!
    : null;
}
export function normalizeContactInput(input: ContactInput): ContactInput {
  const normalized = {
    ...input,
    tahoe_id: text(input.tahoe_id),
    first_name: text(input.first_name),
    last_name: text(input.last_name),
    city: text(input.city),
    state: text(input.state).toUpperCase(),
    channels: input.channels || ('email' as const),
  };
  if (
    !normalized.tahoe_id &&
    !(
      normalized.first_name &&
      normalized.last_name &&
      normalized.city &&
      /^[A-Z]{2}$/.test(normalized.state)
    )
  )
    throw new Error(
      'Provide tahoe_id, or first_name, last_name, city and a two-letter US state code. Name searches require identity review.',
    );
  if (!['email', 'mobile', 'both'].includes(normalized.channels))
    throw new Error('channels must be email, mobile or both.');
  return normalized;
}

const NANP_NATIONAL = /^[2-9]\d{2}[2-9]\d{6}$/;

/**
 * E.164 form of a phone string, or null when its country cannot be known.
 *
 * Digit-stripping alone invents numbers: national-format "086 822 9757"
 * (Ireland) became +10868229757 and "07891 144054" (UK) became +07891144054,
 * and each was then paid for at validation. A leading 0 is a national trunk
 * prefix with no country, so it is rejected. Country code 1 is NANP, which is
 * exactly 11 digits with a valid area code and exchange. Without a "+", a
 * bare 10 digits is read as NANP under the same rule, and 11-15 digits as
 * carrying their own country code.
 */
export function toE164Phone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) return null;
  if (digits.startsWith('1'))
    return digits.length === 11 && NANP_NATIONAL.test(digits.slice(1))
      ? `+${digits}`
      : null;
  // An explicit "+" already names the country; E.164 numbers can be this short.
  if (raw.trim().startsWith('+'))
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10)
    return NANP_NATIONAL.test(digits) ? `+1${digits}` : null;
  return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : null;
}

function personSummary(person: Record<string, unknown>): Person {
  const name = object(person.name);
  return {
    name:
      text(person.fullName) ||
      [name.firstName, name.middleName, name.lastName]
        .map(text)
        .filter(Boolean)
        .join(' '),
    tahoe_id: text(person.tahoeId) || null,
  };
}
export function resolvePerson(
  input: ContactInput,
  data: Record<string, unknown>,
): PersonResult {
  const normalized = normalizeContactInput(input);
  const persons = rows(data.persons).filter((person) =>
    normalized.tahoe_id
      ? text(person.tahoeId) === normalized.tahoe_id
      : key(object(person.name).firstName) === key(normalized.first_name) &&
        key(object(person.name).lastName) === key(normalized.last_name) &&
        rows(person.addresses).some(
          (address) =>
            key(address.city) === key(normalized.city) &&
            text(address.state).toUpperCase() === normalized.state,
        ),
  );
  const result: PersonResult = {
    identity_match: 'not_found',
    person: null,
    held_people: [],
    email_candidates: [],
    mobile_candidates: [],
    miss_reason: 'no_matching_person',
  };
  if (!persons.length) return result;
  if (!normalized.tahoe_id || persons.length !== 1)
    return {
      ...result,
      identity_match: persons.length > 1 ? 'ambiguous' : 'review_required',
      held_people: persons.map(personSummary).slice(0, 10),
      miss_reason: 'confirm_person_identifier_before_contact_lookup',
    };
  const person = persons[0]!;
  return {
    ...result,
    identity_match: 'exact_id',
    person: personSummary(person),
    miss_reason: null,
    email_candidates: [
      ...new Set(
        rows(person.emailAddresses)
          .filter((email) => email.nonBusiness === 1)
          .sort(
            (a, b) =>
              Number(a.emailOrdinal ?? 999) - Number(b.emailOrdinal ?? 999) ||
              text(a.emailAddress).localeCompare(text(b.emailAddress)),
          )
          .map((email) => text(email.emailAddress).toLowerCase())
          .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
      ),
    ].slice(0, 3),
    mobile_candidates: [
      ...new Set(
        rows(person.phoneNumbers)
          .filter(
            (phone) =>
              phone.isConnected === true &&
              /^(wireless|mobile)$/i.test(text(phone.phoneType)),
          )
          .map((phone) => toE164Phone(text(phone.phoneNumber)))
          .filter((phone): phone is string => phone !== null),
      ),
    ]
      .sort()
      .slice(0, 3),
  };
}
export function emptyChannel(status = 'not_requested'): ChannelResult {
  return { value: null, validation_status: status, attempted_candidates: 0 };
}
