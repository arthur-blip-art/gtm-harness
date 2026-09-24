import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import type { ToolDef } from '../core/types.ts';

const BASE = 'https://api.hubapi.com';
const PRICE = {
  search_objects: { basis: 'free', credits: 0, note: 'no credits; rate limit ~4 search req/s (private app)' },
  batch_upsert: { basis: 'free', credits: 0, note: 'no credits; ≤100 inputs per batch' },
  create: { basis: 'free', credits: 0 },
  update: { basis: 'free', credits: 0 },
  associate: { basis: 'free', credits: 0 },
} as const;

/** CRM state changes between calls: every tool is marked noCache so receipts are never replayed. */
function noCache(def: ToolDef): ToolDef & { noCache: true } {
  return { ...def, noCache: true }; // honoured by ToolRunner
}

function headers() {
  return { 'content-type': 'application/json', authorization: `Bearer ${env('HUBSPOT_TOKEN') ?? ''}` };
}

const objectType = (v: unknown) => String(v ?? 'contacts').trim().toLowerCase();
const props = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const strArr = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(String))].sort() : []);
const ok = (s: number) => s >= 200 && s < 300;
const errMsg = (b: any) => b?.message ?? b?.errors?.[0]?.message;

/** HubSpot CRM v3/v4 via a private-app token. Free, but never cached: search results and writes reflect live CRM state. */
export const hubspot = defineAdapter({
  name: 'hubspot',
  pricing: { usdPerCredit: 0, verifiedOn: '2026-09-24 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['HUBSPOT_TOKEN'],
  tools: {
    search_objects: noCache({
      description: 'Search CRM objects by property filters (EQ by default); returns id + requested properties.',
      normalize: (i) => {
        const filters = Array.isArray(i.filters)
          ? (i.filters as any[]).map((f) => ({ propertyName: String(f.propertyName), operator: String(f.operator ?? 'EQ'), ...(f.value !== undefined ? { value: String(f.value) } : {}), ...(f.values ? { values: strArr(f.values) } : {}) }))
          : i.propertyName ? [{ propertyName: String(i.propertyName), operator: String(i.operator ?? 'EQ'), value: String(i.value ?? '') }] : [];
        return { objectType: objectType(i.objectType), filters, properties: strArr(i.properties), limit: Math.min(Number(i.limit ?? 10), 100) };
      },
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/crm/v3/objects/${i.objectType}/search`, { // verify against docs
          method: 'POST', headers: headers(),
          body: JSON.stringify({ filterGroups: [{ filters: i.filters }], properties: i.properties, limit: i.limit }),
        });
        if (!ok(status)) return errorResult(status, body, errMsg(body));
        const results = ((body?.results ?? []) as any[]).map((r) => ({ id: r.id, properties: r.properties ?? {} }));
        const out = { results, total: Number(body?.total ?? results.length), objectType: i.objectType };
        return results.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'no_match', output: out };
      },
      cost: costFromTable(PRICE.search_objects),
    }),
    batch_upsert: noCache({
      description: 'Batch upsert (≤100) by a unique idProperty (email for contacts; companies need a unique custom property).',
      normalize: (i) => ({
        objectType: objectType(i.objectType), idProperty: String(i.idProperty ?? 'email'),
        inputs: (Array.isArray(i.inputs) ? (i.inputs as any[]) : []).slice(0, 100).map((x) => ({ id: String(x.id), properties: props(x.properties) })),
      }),
      async execute(i, ctx) {
        const inputs = (i.inputs as any[]).map((x) => ({ idProperty: i.idProperty, id: x.id, properties: x.properties }));
        if (!inputs.length) return { status: 'miss', missReason: 'no_inputs', output: { results: [] } };
        const { status, body } = await httpJson(ctx, `${BASE}/crm/v3/objects/${i.objectType}/batch/upsert`, { // verify against docs
          method: 'POST', headers: headers(), body: JSON.stringify({ inputs }),
        });
        if (!ok(status)) return errorResult(status, body, errMsg(body)); // 400 "idProperty not unique" → fall back to search + create/update
        const results = ((body?.results ?? []) as any[]).map((r) => ({ id: r.id, properties: r.properties ?? {}, new: r.new ?? null }));
        const out = { results, status: body?.status ?? null, objectType: i.objectType, errors: body?.errors ?? [] };
        return results.length ? { status: 'hit', output: out } : { status: 'miss', missReason: 'nothing_upserted', output: out };
      },
      cost: costFromTable(PRICE.batch_upsert),
    }),
    create: noCache({
      description: 'Create one CRM object with the given properties.',
      normalize: (i) => ({ objectType: objectType(i.objectType), properties: props(i.properties) }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `${BASE}/crm/v3/objects/${i.objectType}`, { // verify against docs
          method: 'POST', headers: headers(), body: JSON.stringify({ properties: i.properties }),
        });
        if (status === 409) return { status: 'miss', missReason: 'already_exists', output: pick(body ?? {}, ['message', 'category']), httpStatus: status };
        if (!ok(status)) return errorResult(status, body, errMsg(body));
        return { status: 'hit', output: { id: body?.id, properties: body?.properties ?? {}, objectType: i.objectType } };
      },
      cost: costFromTable(PRICE.create),
    }),
    update: noCache({
      description: 'Update (PATCH) one CRM object by id.',
      normalize: (i) => ({ objectType: objectType(i.objectType), id: String(i.id ?? ''), properties: props(i.properties) }),
      async execute(i, ctx) {
        if (!i.id) return { status: 'miss', missReason: 'no_id', output: {} };
        const { status, body } = await httpJson(ctx, `${BASE}/crm/v3/objects/${i.objectType}/${encodeURIComponent(String(i.id))}`, { // verify against docs
          method: 'PATCH', headers: headers(), body: JSON.stringify({ properties: i.properties }),
        });
        if (status === 404) return { status: 'miss', missReason: 'not_found', output: pick(body ?? {}, ['message']), httpStatus: status };
        if (!ok(status)) return errorResult(status, body, errMsg(body));
        return { status: 'hit', output: { id: body?.id, properties: body?.properties ?? {}, objectType: i.objectType } };
      },
      cost: costFromTable(PRICE.update),
    }),
    associate: noCache({
      description: 'Associate a contact with a company (default association type).',
      normalize: (i) => ({ contactId: String(i.contactId ?? ''), companyId: String(i.companyId ?? '') }),
      async execute(i, ctx) {
        if (!i.contactId || !i.companyId) return { status: 'miss', missReason: 'missing_ids', output: {} };
        const url = `${BASE}/crm/v4/objects/contacts/${encodeURIComponent(String(i.contactId))}/associations/default/companies/${encodeURIComponent(String(i.companyId))}`; // verify against docs
        const { status, body } = await httpJson(ctx, url, { method: 'PUT', headers: headers() });
        if (status === 404) return { status: 'miss', missReason: 'not_found', output: pick(body ?? {}, ['message']), httpStatus: status };
        if (!ok(status)) return errorResult(status, body, errMsg(body));
        return { status: 'hit', output: { contactId: i.contactId, companyId: i.companyId, results: body?.results ?? body ?? [] } };
      },
      cost: costFromTable(PRICE.associate),
    }),
  },
});
