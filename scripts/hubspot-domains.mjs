#!/usr/bin/env node
// Read-only: every company domain already in HubSpot, one per line, to exclude accounts we already know.
//   node scripts/hubspot-domains.mjs --out known.txt   (or stdout without --out)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(process.env.GTM_HOME ?? root, '.env'), quiet: true });
const token = process.env.HUBSPOT_TOKEN;
if (!token) { console.error('HUBSPOT_TOKEN is not set in .env'); process.exit(2); }

const domains = new Set();
let after;
do {
  const url = `https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=domain${after ? `&after=${after}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { console.error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }
  const json = await res.json();
  for (const c of json.results ?? []) {
    const d = String(c.properties?.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (d) domains.add(d);
  }
  after = json.paging?.next?.after;
} while (after);
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const text = [...domains].sort().join('\n') + '\n';
if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
console.error(`${domains.size} company domains in HubSpot`);
