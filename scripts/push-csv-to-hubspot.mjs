#!/usr/bin/env node
// Push a signal-first CSV straight into HubSpot, without the Supabase store.
//   node scripts/push-csv-to-hubspot.mjs --csv leads.csv            → preview, writes nothing
//   node scripts/push-csv-to-hubspot.mjs --csv leads.csv --write    → create gtm_* properties, upsert, associate
// Companies are matched by domain, contacts by email. Only HIGH/MEDIUM emails become contacts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(process.env.GTM_HOME ?? root, '.env'), quiet: true });

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const csvPath = opt('--csv');
const write = flag('--write');
if (!csvPath) { console.error('usage: push-csv-to-hubspot.mjs --csv <file> [--write]'); process.exit(2); }
const token = process.env.HUBSPOT_TOKEN;
if (!token) { console.error('HUBSPOT_TOKEN is not set in .env'); process.exit(2); }

// CSV column → HubSpot property. gtm_* are custom and created on --write when missing.
const COMPANY_MAP = { domain: 'domain', company: 'name', city: 'city', signal: 'gtm_signal', signal_date: 'gtm_signal_date', signal_source: 'gtm_signal_source', integrations_today: 'gtm_integrations_today', coverage_gap: 'gtm_coverage_gap', fit_grade: 'gtm_fit_grade' };
const CONTACT_MAP = { email: 'email', first_name: 'firstname', last_name: 'lastname', title: 'jobtitle', linkedin_url: 'hs_linkedin_url', city: 'city', company: 'company', confidence: 'gtm_confidence', signal: 'gtm_signal', signal_date: 'gtm_signal_date', signal_source: 'gtm_signal_source', integrations_today: 'gtm_integrations_today', coverage_gap: 'gtm_coverage_gap' };
const CUSTOM = { gtm_signal: ['GTM signal', 'textarea'], gtm_signal_date: ['GTM signal date', 'text'], gtm_signal_source: ['GTM signal source', 'text'], gtm_integrations_today: ['GTM integrations today', 'textarea'], gtm_coverage_gap: ['GTM coverage gap', 'textarea'], gtm_fit_grade: ['GTM fit grade', 'text'], gtm_confidence: ['GTM email confidence', 'text'] };
const GROUP = { companies: 'companyinformation', contacts: 'contactinformation' };

async function hs(method, url, body) {
  const res = await fetch(`https://api.hubapi.com${url}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${json.message ?? text.slice(0, 200)}`);
  return json;
}
const pick = (row, map, known) => Object.fromEntries(Object.entries(map).filter(([col, prop]) => row[col] && known.has(prop)).map(([col, prop]) => [prop, String(row[col]).trim()]));

const rows = parse(fs.readFileSync(csvPath), { columns: true, skip_empty_lines: true, trim: true });
const known = {}, missing = {};
for (const obj of ['companies', 'contacts']) {
  const existing = new Set((await hs('GET', `/crm/v3/properties/${obj}`)).results.map((p) => p.name));
  const map = obj === 'companies' ? COMPANY_MAP : CONTACT_MAP;
  const used = [...new Set(Object.entries(map).filter(([col]) => rows.some((r) => r[col])).map(([, prop]) => prop))];
  missing[obj] = used.filter((p) => !existing.has(p));
  known[obj] = existing;
}

const byDomain = new Map();
for (const r of rows) if (r.domain && !byDomain.has(r.domain.toLowerCase())) byDomain.set(r.domain.toLowerCase(), r);
const sendable = rows.filter((r) => r.email && ['HIGH', 'MEDIUM'].includes(String(r.confidence).toUpperCase()));
const held = rows.length - sendable.length;

console.log(`file: ${csvPath}   rows: ${rows.length}   companies: ${byDomain.size}   contacts to push: ${sendable.length}   held back (no email or not HIGH/MEDIUM): ${held}`);
for (const obj of ['companies', 'contacts']) {
  const custom = missing[obj].filter((p) => CUSTOM[p]); const unknown = missing[obj].filter((p) => !CUSTOM[p]);
  console.log(`${obj}: properties to create: ${custom.join(', ') || 'none'}${unknown.length ? `   unknown in this portal, dropped: ${unknown.join(', ')}` : ''}`);
}

if (!write) {
  const all = { companies: new Set([...known.companies, ...Object.keys(CUSTOM)]), contacts: new Set([...known.contacts, ...Object.keys(CUSTOM)]) };
  console.log('\nPREVIEW (nothing written). First company and contact as they would be sent:');
  console.log(JSON.stringify({ company: pick([...byDomain.values()][0] ?? {}, COMPANY_MAP, all.companies), contact: pick(sendable[0] ?? {}, CONTACT_MAP, all.contacts) }, null, 2));
  console.log('\nRe-run with --write to create the properties and upsert.');
  process.exit(0);
}

for (const obj of ['companies', 'contacts']) for (const name of missing[obj].filter((p) => CUSTOM[p])) {
  const [label, fieldType] = CUSTOM[name];
  await hs('POST', `/crm/v3/properties/${obj}`, { name, label, type: 'string', fieldType, groupName: GROUP[obj] });
  known[obj].add(name);
  console.log(`created property ${obj}.${name}`);
}

const out = { companies_created: 0, companies_updated: 0, contacts_upserted: 0, associated: 0, errors: [] };
const companyId = new Map();
for (const [domain, r] of byDomain) {
  try {
    const props = pick(r, COMPANY_MAP, known.companies);
    const found = await hs('POST', '/crm/v3/objects/companies/search', { filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }], properties: ['domain'], limit: 1 });
    if (found.results?.[0]) { await hs('PATCH', `/crm/v3/objects/companies/${found.results[0].id}`, { properties: props }); companyId.set(domain, found.results[0].id); out.companies_updated++; }
    else { const c = await hs('POST', '/crm/v3/objects/companies', { properties: props }); companyId.set(domain, c.id); out.companies_created++; }
  } catch (e) { out.errors.push(`company ${domain}: ${e.message}`); }
}
for (let i = 0; i < sendable.length; i += 100) {
  const chunk = sendable.slice(i, i + 100);
  try {
    const res = await hs('POST', '/crm/v3/objects/contacts/batch/upsert', { inputs: chunk.map((r) => ({ idProperty: 'email', id: r.email.toLowerCase(), properties: pick(r, CONTACT_MAP, known.contacts) })) });
    for (const c of res.results ?? []) {
      out.contacts_upserted++;
      const row = chunk.find((r) => r.email.toLowerCase() === String(c.properties?.email ?? '').toLowerCase());
      const cid = row && companyId.get(String(row.domain).toLowerCase());
      if (cid) { try { await hs('PUT', `/crm/v4/objects/contacts/${c.id}/associations/default/companies/${cid}`); out.associated++; } catch (e) { out.errors.push(`associate ${row.email}: ${e.message}`); } }
    }
  } catch (e) { out.errors.push(`contacts batch ${i}: ${e.message}`); }
}
console.log(JSON.stringify(out, null, 2));
process.exit(out.errors.length ? 1 : 0);
