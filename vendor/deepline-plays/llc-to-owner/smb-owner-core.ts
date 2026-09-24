import type { DeeplinePlayRuntimeContext } from 'deepline';
import {
  emptyChannel,
  normalizeEntityInput,
  normalizeContactInput,
  providerData,
  resolveEntity,
  resolvePerson,
  text,
  type EntityInput,
  type EntityResult,
  type ContactInput,
  type ContactResult,
  type ChannelResult,
} from './smb-owner-helpers';

export async function lookupEntity(
  row: EntityInput,
  ctx: DeeplinePlayRuntimeContext,
): Promise<EntityResult> {
  const input = normalizeEntityInput(row);
  const result = await ctx.tools.execute({
    id: 'business_search',
    tool: 'enformion_business_search',
    description:
      'Find filings for the legal business in its state with one search attempt.',
    input: {
      name: input.legal_name,
      city_state: input.city ? `${input.city}, ${input.state}` : input.state,
      max_attempts: 1,
      results_per_page: 10,
      page: 1,
    },
  });
  return resolveEntity(input, providerData(result));
}

async function lookupPerson(
  row: ContactInput,
  ctx: DeeplinePlayRuntimeContext,
) {
  const input = normalizeContactInput(row);
  const result = await ctx.tools.execute({
    id: 'person_search',
    tool: 'enformion_person_search',
    description:
      'Look up the exact person ID, or return name and locality matches for review.',
    input: input.tahoe_id
      ? { tahoe_id: input.tahoe_id }
      : {
          first_name: input.first_name,
          last_name: input.last_name,
          city_state: `${input.city}, ${input.state}`,
        },
  });
  return resolvePerson(input, providerData(result));
}

type ContactRow = ContactInput & {
  person_resolution: Awaited<ReturnType<typeof lookupPerson>>;
};

async function validatePersonalEmail(
  row: ContactRow,
  ctx: DeeplinePlayRuntimeContext,
): Promise<ChannelResult> {
  if (normalizeContactInput(row).channels === 'mobile') return emptyChannel();
  if (row.person_resolution.identity_match !== 'exact_id')
    return emptyChannel('identity_not_confirmed');
  const candidates = row.person_resolution.email_candidates;
  let status = 'no_candidate';
  for (const [index, email] of candidates.entries()) {
    const result = await ctx.tools.execute({
      id: 'personal_email_candidate',
      tool: 'leadmagic_email_validation',
      input: { email },
      description:
        'Validate a personal email tied to the exact person identifier.',
    });
    const data = providerData(result);
    status = text(data.email_status).toLowerCase() || 'unknown';
    if (
      status === 'valid' &&
      data.is_domain_catch_all === false &&
      text(data.email).toLowerCase() === email
    )
      return {
        value: email,
        validation_status: 'valid',
        attempted_candidates: index + 1,
      };
    if (data.is_domain_catch_all === true) status = 'catch_all';
  }
  return {
    value: null,
    validation_status: status === 'valid' ? 'unconfirmed_validation' : status,
    attempted_candidates: candidates.length,
  };
}

async function validateMobile(
  row: ContactRow,
  ctx: DeeplinePlayRuntimeContext,
): Promise<ChannelResult> {
  if (normalizeContactInput(row).channels === 'email') return emptyChannel();
  if (row.person_resolution.identity_match !== 'exact_id')
    return emptyChannel('identity_not_confirmed');
  const candidates = row.person_resolution.mobile_candidates;
  let status = 'no_candidate';
  for (const [index, phone] of candidates.entries()) {
    const result = await ctx.tools.execute({
      id: 'mobile_candidate',
      tool: 'trestle_phone_validation',
      input: { phone },
      description:
        'Validate activity and mobile line type for an identity-bound phone candidate.',
    });
    const data = providerData(result);
    const score =
      typeof data.activity_score === 'number' ? data.activity_score : null;
    status =
      data.is_valid === false
        ? 'invalid'
        : score !== null && score < 30
          ? 'stale'
          : data.is_valid === true &&
              score !== null &&
              score >= 30 &&
              text(data.line_type) &&
              !/^(mobile|wireless)$/i.test(text(data.line_type))
            ? 'wrong_line_type'
            : 'unknown';
    const returnedPhone = text(data.phone_number ?? data.phone).replace(
      /\D/g,
      '',
    );
    if (
      data.is_valid === true &&
      score !== null &&
      score >= 30 &&
      /^(mobile|wireless)$/i.test(text(data.line_type)) &&
      returnedPhone === phone.replace(/\D/g, '')
    )
      return {
        value: phone,
        validation_status: 'valid',
        attempted_candidates: index + 1,
      };
  }
  return {
    value: null,
    validation_status: status,
    attempted_candidates: candidates.length,
  };
}

export async function lookupContact(
  input: ContactInput,
  ctx: DeeplinePlayRuntimeContext,
): Promise<ContactResult> {
  const person_resolution = await lookupPerson(input, ctx);
  const row = { ...input, person_resolution };
  const personal_email = await validatePersonalEmail(row, ctx);
  const mobile = await validateMobile(row, ctx);
  return {
    person: person_resolution.person,
    identity_match: person_resolution.identity_match,
    held_people: person_resolution.held_people,
    personal_email,
    mobile,
    miss_reason:
      person_resolution.miss_reason ??
      (personal_email.value || mobile.value
        ? null
        : 'no_validated_requested_contact'),
  };
}
