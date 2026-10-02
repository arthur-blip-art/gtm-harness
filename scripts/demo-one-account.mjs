#!/usr/bin/env node
// Live demo, one account end to end: domain → integrations page read live → score → contacts → HubSpot.
//   node scripts/demo-one-account.mjs --domain shiftbase.com            → preview, writes nothing
//   node scripts/demo-one-account.mjs --domain shiftbase.com --write    → lands in HubSpot
// Live in the demo: the integrations page fetch, the gap computation, the score, the HubSpot write.
// Read from the prepared list (gtm-data/chift-test/chift-outbound-30.csv): the dated timing signal that an
// agent researched and verified, and the contacts with their verified emails (FullEnrich is async, 1 to 4 min).
// A domain outside the list goes live end to end: FullEnrich people search (0.25 credit a person), then the
// FullEnrich email waterfall (1 credit an email found), no database (--no-db). --rehearse mocks both, spends nothing.
//   node scripts/demo-one-account.mjs --domain finom.co --people 2 --max-credits 10
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const domain = (opt('--domain') ?? '').toLowerCase(); const write = args.includes('--write');
const listPath = opt('--list', path.join(root, 'gtm-data/chift-test/chift-outbound-30.csv'));
if (!domain) { console.error('usage: demo-one-account.mjs --domain <domain> [--write]'); process.exit(2); }
const node = process.execPath; const t0 = Date.now(); const lap = (label, since) => console.log(`   ${label}: ${((Date.now() - since) / 1000).toFixed(1)} s`);
const run = (script, a) => execFileSync(node, [path.join(root, 'scripts', script), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// The prepared list lives in gtm-data/ (git-ignored, personal data). On a fresh clone it is absent: every domain goes live.
const rows = fs.existsSync(listPath) ? parse(fs.readFileSync(listPath), { columns: true, skip_empty_lines: true }).filter((r) => r.domain.toLowerCase() === domain) : [];
const rehearse = args.includes('--rehearse');
const prepared = rows.length > 0;

console.log(`\n1. Reading ${domain}'s integrations page, live`);
let t = Date.now();
const live = JSON.parse(run('integrations-signal.mjs', ['--domain', domain, '--countries', 'FR,BE,NL,DE,ES']));
console.log(`   page: ${live.integrations_page_url ?? live.integrations_status}`);
console.log(`   accounting software named: ${live.accounting_today || 'none read by the script'}`);
console.log(`   countries with no local ledger: ${live.countries_with_no_local_ledger || '-'}`);
lap('read', t);

if (prepared) {
  const a = rows[0];
  console.log('\n2. Verified facts for this account (agent research, re-read at the source)');
  console.log(`   signal (${a.signal_date}): ${a.signal}`);
  console.log(`   gap: ${a.coverage_gap}`);
  console.log(`   angle: ${a.angle}   tier: ${a.tier}`);
  console.log(`   first line of message 1: ${a.email_first_line}`);
} else {
  console.log(`\n2. ${domain} is not in the prepared list: contacts found live${rehearse ? ' (rehearsal, mocked providers, nothing spent)' : ''}`);
  t = Date.now();
  const gtm = (a) => execFileSync(node, [path.join(root, 'bin/gtm.mjs'), ...a, ...(rehearse ? ['--dry-run'] : ['--no-db'])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const titles = (opt('--titles', 'CEO,Founder,CTO,CPO,Head of Partnerships,Head of Product')).split(',');
  const maxCredits = opt('--max-credits', '10');
  const found = gtm(['run', 'company-to-people', '--legs', 'fullenrich', '--max-credits', maxCredits, '--input', JSON.stringify({ domain, titles, limit: Number(opt('--people', '2')) })]);
  const people = JSON.parse(found.slice(0, found.indexOf('\nCOST RECEIPT'))).people ?? [];
  console.log(`   people search: ${people.length} found`);
  lap('people', t);
  if (!people.length) { console.log('   nobody found at this domain: nothing to push.'); process.exit(0); }
  const company = live.integrations_page_url ? new URL(live.integrations_page_url).hostname.replace(/^www\./, '').split('.')[0] : domain.split('.')[0];
  const base = { company: company[0].toUpperCase() + company.slice(1), domain, integrations_today: live.accounting_today ?? '', coverage_gap: live.coverage_gap ?? '', signal: 'Coverage gap read live on the public integrations page', signal_date: new Date().toISOString().slice(0, 10), signal_source: live.integrations_page_url ?? '' };
  const inCsv = path.join(os.tmpdir(), `gtm-demo-${domain}.people.csv`), outCsv = inCsv.replace('.people.', '.emails.');
  fs.writeFileSync(inCsv, stringify(people.map((p) => ({ ...base, first_name: p.first_name, last_name: p.last_name, title: p.title ?? '', linkedin_url: p.linkedin_url ?? '' })), { header: true }));
  t = Date.now();
  gtm(['run', 'name-domain-to-email', '--csv', inCsv, '--out', outCsv, '--legs', 'fullenrich', '--max-credits', maxCredits]);
  rows.push(...parse(fs.readFileSync(outCsv), { columns: true, skip_empty_lines: true }));
  fs.rmSync(inCsv, { force: true }); fs.rmSync(outCsv, { force: true });
  lap('emails', t);
  if (rehearse) { console.log('\n3. Contacts (rehearsal: mocked)'); for (const r of rows) console.log(`   ${r.first_name} ${r.last_name}, ${r.title} · ${r.email || 'no email'} (${r.confidence || '-'})`); console.log('\nRehearsal ends here: HubSpot is not called.\n'); process.exit(0); }
}

console.log('\n3. Contacts');
for (const r of rows) if (r.first_name) console.log(`   ${r.first_name} ${r.last_name}, ${r.title} · ${r.email || 'no email'} (${r.confidence || '-'})`);

console.log(`\n4. HubSpot ${write ? 'write' : 'preview (nothing written)'}`);
t = Date.now();
const tmp = path.join(os.tmpdir(), `gtm-demo-${domain}.csv`);
fs.writeFileSync(tmp, stringify(rows, { header: true }));
const out = run('push-csv-to-hubspot.mjs', ['--csv', tmp, ...(write ? ['--write'] : [])]);
fs.rmSync(tmp, { force: true });
console.log(out.split('\n').filter((l) => /^file:|created|companies_|contacts_|associated|errors|properties to create/.test(l.trim())).map((l) => `   ${l.trim()}`).join('\n'));
lap('hubspot', t);
console.log(`\nTotal: ${((Date.now() - t0) / 1000).toFixed(1)} s from domain to CRM${write ? '' : ' (preview)'}\n`);
