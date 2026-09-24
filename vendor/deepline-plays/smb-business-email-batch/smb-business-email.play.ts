import { definePlay, steps } from 'deepline';
import type { ColumnMap, CsvInput } from 'deepline';
import {
  businessEmailCandidates,
  businessEmailResult,
  normalizeSmbBusinessEmailInput,
  type BusinessEmailCandidate,
  type SmbBusinessEmailInput,
} from './smb-business-email-helpers';

export function smbBusinessEmailSteps() {
  return steps<SmbBusinessEmailInput>()
    .step('business', (row) => normalizeSmbBusinessEmailInput(row))
    .step('email_candidates', async (row, ctx) => {
      const lookup = await ctx.tools.execute({
        id: 'business_email_lookup',
        tool: 'openmart_lookup_business_email',
        input: {
          tasks: [
            {
              company_name: row.business.business_name,
              domain: row.business.domain,
              city: row.business.city ?? '',
              state: row.business.state ?? '',
              country: row.business.country ?? '',
            },
          ],
          wait_for_completion: true,
        },
        description:
          'Look up business email candidates for the supplied business domain.',
      });
      if (lookup.status === 'no_result') {
        return businessEmailCandidates({ results: [] }, row.business.domain);
      }
      if (lookup.status !== 'completed') {
        throw new Error(
          `Business email lookup has not completed (status: ${lookup.status}).`,
        );
      }
      return businessEmailCandidates(
        lookup.toolResponse.rawV2,
        row.business.domain,
      );
    })
    .step('validated_candidates', async (row, ctx) => {
      const candidates: BusinessEmailCandidate[] = [];
      for (const candidate of row.email_candidates.candidates) {
        const validation = await ctx.tools.execute({
          id: 'validate_business_email',
          tool: 'leadmagic_email_validation',
          input: { email: candidate.email },
          description:
            'Check deliverability independently of the business association.',
        });
        if (!['completed', 'no_result'].includes(validation.status)) {
          throw new Error(
            `Email validation has not completed (status: ${validation.status}).`,
          );
        }
        const returnedEmail = validation.extractedValues.email?.get();
        if (
          typeof returnedEmail === 'string' &&
          returnedEmail.trim().toLowerCase() !== candidate.email
        ) {
          throw new Error(
            'Email validation returned a different address from the requested candidate.',
          );
        }
        const verdict = validation.extractedValues.email_status?.get();
        const validation_status =
          verdict && typeof verdict === 'object' && 'status' in verdict
            ? String(verdict.status)
            : 'unknown';
        candidates.push({
          ...candidate,
          validation_status,
          provider_response: {
            discovery: candidate.provider_response,
            validation: validation.toolResponse.rawV2,
          },
        });
      }
      return candidates;
    })
    .return((row) =>
      businessEmailResult(row.email_candidates, row.validated_candidates),
    );
}

export const scalar = definePlay(
  'smb-business-email',
  async (ctx, input: SmbBusinessEmailInput) => {
    return ctx.runSteps(smbBusinessEmailSteps(), input);
  },
  {
    description:
      'Find up to three business email candidates with OpenMart and validate them with LeadMagic. Select only a valid address on the supplied business domain; retain off-domain addresses and catch-all results for review. The supplied domain must already identify the business.',
  },
);

export const batch = definePlay(
  'smb-business-email-batch',
  async (
    ctx,
    input: {
      csv: CsvInput<SmbBusinessEmailInput>;
      columns?: ColumnMap<SmbBusinessEmailInput>;
    },
  ): Promise<Record<string, unknown>> => {
    const businesses = await ctx.csv<SmbBusinessEmailInput>(input.csv, {
      description: 'Load businesses with a known name and website domain.',
      columns: {
        business_name: 'business_name',
        domain: 'domain',
        city: 'city',
        state: 'state',
        country: 'country',
        ...input.columns,
      },
      required: ['business_name', 'domain'],
    });
    const rows = await ctx
      .dataset('business_email_rows', businesses)
      .withColumn('business_email_result', smbBusinessEmailSteps())
      .withColumn('email', (row) => row.business_email_result.email)
      .withColumn(
        'email_source',
        (row) => row.business_email_result.email_source,
      )
      .withColumn('candidates', (row) => row.business_email_result.candidates)
      .withColumn(
        'candidate_count',
        (row) => row.business_email_result.candidate_count,
      )
      .withColumn('truncated', (row) => row.business_email_result.truncated)
      .withColumn('miss_reason', (row) => row.business_email_result.miss_reason)
      .run({ description: 'Find and validate business emails for each row.' });
    return { rows };
  },
  {
    description:
      'Find business email candidates for CSV rows using the same bounded lookup and validation as smb-business-email.',
  },
);

export default scalar;
