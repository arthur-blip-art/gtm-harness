import { costFromTable, defineAdapter, errorResult, httpJson, pick, sleep } from './_adapter.ts';
import { env } from '../config.ts';
import { nameToken } from '../core/normalize.ts';
import type { ToolInput, ToolResult } from '../core/types.ts';

const BASE = 'https://app.fullenrich.com/api/v1/contact/enrich';
const PRICE = { bulk_enrich: { basis: 'per_hit', credits: 1, note: 'per contact with an email found; phones ~10x, never requested here' } } as const;
const POLL_MS = 15_000;
const MAX_WAIT_MS = 15 * 60_000;

/**
 * FullEnrich: async bulk waterfall over 20+ sources. Submit ≤50 contacts, poll every 15 s.
 * Status hierarchy DELIVERABLE > HIGH_PROBABILITY > CATCH_ALL > INVALID. Only emails requested.
 * A cancelled local run still bills the provider: the enrichment_id is logged before polling so it can be fetched later.
 */
export const fullenrich = defineAdapter({
  name: 'fullenrich',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-23 (estimate, check your plan)', table: PRICE },
  requiredEnv: ['FULLENRICH_API_KEY'],
  tools: {
    bulk_enrich: {
      description: 'Batch work-email enrichment from name + domain (LinkedIn URL improves accuracy).',
      maxBatch: 50,
      normalize: (i) => ({
        first_name: nameToken(i.first_name), last_name: nameToken(i.last_name),
        ...pick(i, ['domain', 'linkedin_url', 'company']),
      }),
      async executeBatch(inputs, ctx) {
        const headers = { 'content-type': 'application/json', authorization: `Bearer ${env('FULLENRICH_API_KEY') ?? ''}` };
        const datas = inputs.map((i, idx) => ({
          firstname: i.first_name, lastname: i.last_name, domain: i.domain,
          ...(i.company ? { company_name: i.company } : {}),
          ...(i.linkedin_url ? { linkedin_url: i.linkedin_url } : {}),
          enrich_fields: ['contact.emails'],
          custom: { idx: String(idx) },
        }));
        const submit = await httpJson(ctx, `${BASE}/bulk`, {
          method: 'POST', headers, body: JSON.stringify({ name: `gtm-engine ${new Date().toISOString()}`, datas }),
        });
        if (submit.status !== 200 && submit.status !== 201) {
          const err = errorResult(submit.status, submit.body, submit.body?.message);
          return inputs.map(() => err);
        }
        const id = submit.body?.enrichment_id ?? submit.body?.id;
        if (!id) return inputs.map(() => errorResult(submit.status, submit.body, 'no enrichment_id in response'));
        ctx.log(`fullenrich enrichment_id=${id} (resume: GET ${BASE}/bulk/${id})`);

        const started = Date.now();
        let result: any = null;
        for (;;) {
          await sleep(POLL_MS);
          const poll = await httpJson(ctx, `${BASE}/bulk/${id}`, { headers });
          if (poll.status !== 200) return inputs.map(() => errorResult(poll.status, poll.body, `poll failed for ${id}`));
          const st = String(poll.body?.status ?? '').toUpperCase();
          ctx.log(`fullenrich ${id}: ${st}`);
          if (st === 'FINISHED' || st === 'COMPLETED' || st === 'DONE') { result = poll.body; break; }
          if (st === 'CANCELED' || st === 'CANCELLED' || st === 'FAILED') return inputs.map(() => errorResult(200, poll.body, `enrichment ${st}`));
          if (Date.now() - started > MAX_WAIT_MS) return inputs.map(() => errorResult(200, { enrichment_id: id }, `timeout waiting for ${id}; fetch later`));
        }
        return mapResults(inputs, result);
      },
      cost: costFromTable(PRICE.bulk_enrich),
    },
  },
});

function mapResults(inputs: ToolInput[], body: any): ToolResult[] {
  const rows: any[] = body?.datas ?? body?.data ?? [];
  const byIdx = new Map<string, any>();
  rows.forEach((r, i) => byIdx.set(String(r?.custom?.idx ?? i), r));
  return inputs.map((_, idx) => {
    const r = byIdx.get(String(idx));
    if (!r) return { status: 'miss', missReason: 'not_in_response', output: {} };
    const c = r.contact ?? r;
    const best = c.most_probable_work_email ?? c.most_probable_email ?? c.emails?.[0]?.email;
    const emails: { email: string; status: string }[] = (c.emails ?? []).map((e: any) => ({ email: e.email, status: e.status }));
    const status = emails.find((e) => e.email === best)?.status ?? c.most_probable_work_email_status ?? c.email_status;
    const out = { email: best, email_status: status, emails, ...pick(c, ['firstname', 'lastname', 'linkedin_url', 'job_title', 'domain']) };
    if (!best) return { status: 'miss', missReason: 'no_email_found', output: out };
    return { status: 'hit', output: out };
  });
}
