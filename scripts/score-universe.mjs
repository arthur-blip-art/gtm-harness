#!/usr/bin/env node
// Rank a universe CSV (after integrations-signal.mjs) into tiers A/B/C with auditable reasons.
// Rules, not a model: every point is named, so an AE can read why an account is on the list.
//   node scripts/score-universe.mjs --csv a.signals.csv --csv b.signals.csv --out ranked.csv [--today 2026-09-30]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const args = process.argv.slice(2);
const all = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const opt = (n, d) => all(n)[0] ?? d;
const files = all('--csv'); const outPath = opt('--out'); const today = new Date(opt('--today', new Date().toISOString().slice(0, 10)));
if (!files.length || !outPath) { console.error('usage: score-universe.mjs --csv in.csv [--csv in2.csv] --out ranked.csv'); process.exit(2); }

// Catalog fingerprint: Chift is sold white-label, so a customer is invisible in page source. But a vendor that lists
// most of Chift's long-tail local ledgers for a country (ACD, Fulll, MyUnisoft, Tiime…) almost certainly plugs into
// Chift or a competitor. We read that fingerprint from the accounting names found on the page.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogFile = opt('--catalog', path.join(root, 'gtm-data/chift-test/chift-catalog.json'));
const LOCAL = fs.existsSync(catalogFile) ? (JSON.parse(fs.readFileSync(catalogFile, 'utf8')).accounting_by_country_local_only ?? {}) : {};
function fingerprint(accountingToday) {
  const have = new Set(String(accountingToday ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  let best = null;
  for (const [country, names] of Object.entries(LOCAL)) {
    const hit = names.filter((n) => have.has(n)).length;
    if (names.length >= 4 && hit >= 5 && hit / names.length >= 0.5 && (!best || hit > best.hit)) best = { country, hit, total: names.length };
  }
  return best;
}

const FINANCE_CORE = new Set(['fintech_b2b', 'payment', 'spend', 'treasury', 'lending', 'neobank', 'invoicing', 'erp']);
const TIMING = { job: 25, expansion: 25, changelog: 20, new_exec: 15, funding: 15, e_invoicing: 10, none: 0 };
const num = (v) => (v === undefined || v === '' ? 0 : Number(v) || 0);
const monthsAgo = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(ym ?? ''); if (!m) return null; return (today.getFullYear() - Number(m[1])) * 12 + (today.getMonth() + 1 - Number(m[2])); };

function score(r) {
  const reasons = []; let fit = 0, timing = 0;
  const add = (bucket, pts, why) => { if (!pts) return; bucket === 'fit' ? (fit += pts) : (timing += pts); reasons.push(`${pts > 0 ? '+' : ''}${pts} ${why}`); };
  const n = num(r.integrations_count), acc = num(r.accounting_count);
  const sells = String(r.countries ?? '').split(/\s+/).filter(Boolean);
  const noLocal = String(r.countries_with_no_local_ledger ?? '').split(/\s+/).filter(Boolean);
  const status = r.integrations_status;

  // FIT — the brief's hint: accounts that already ship integrations convert best.
  if (status === 'found' && n >= 2) add('fit', 20, `already ships integrations (${n} known names on the page)`);
  else if (String(r.has_integrations_page).toLowerCase() === 'yes') add('fit', 10, 'has an integrations page (names not machine-readable, check by hand)');
  if (acc >= 1 && acc <= 8) add('fit', 15, `integrates ${acc} accounting software: knows the pain, far from full coverage`);
  else if (acc > 12) add('fit', -10, `already covers ${acc} accounting software: likely equipped`);
  else if (acc === 0 && n >= 2) add('fit', 5, 'integrations but no accounting yet');
  if (noLocal.length) add('fit', Math.min(15, 5 * noLocal.length), `no local ledger in ${noLocal.join(', ')} where it sells`);
  add('fit', FINANCE_CORE.has(r.segment) ? 10 : 5, `segment ${r.segment || 'unknown'}`);

  // TIMING — why now.
  const t = TIMING[r.signal_type] ?? 0;
  if (t) add('timing', t, `${r.signal_type} signal`);
  const age = monthsAgo(r.signal_date);
  if (t && age !== null) add('timing', age <= 6 ? 10 : age <= 12 ? 5 : 0, age <= 6 ? `signal is ${age} month(s) old` : 'signal 6 to 12 months old');

  // RISK — never waste an AE's time, never pitch a customer.
  const fp = fingerprint(r.accounting_today);
  if (fp) add('fit', -40, `catalog fingerprint: covers ${fp.hit}/${fp.total} of Chift's local ledgers in ${fp.country}, likely already on Chift or a competitor`);
  if (r.chift_client_risk === 'medium') add('fit', -20, `customer/competitor risk: ${String(r.chift_client_evidence ?? '').slice(0, 80)}`);
  if (r.unified_api_trace) add('fit', -30, `unified API vendor in page source: ${r.unified_api_trace}`);
  if (/above|exceed|over 500|> ?500|may exceed|peut dépasser/i.test(r.notes ?? '')) add('fit', -10, 'headcount may be outside the 50-500 band');
  if (status === 'blocked' || status === 'no_page_found') reasons.push(`0 integrations page ${status}: verify by hand`);

  const total = Math.max(0, fit + timing);
  const tier = total >= 70 && timing > 0 ? 'A' : total >= 50 ? 'B' : 'C';
  return { score: total, fit_score: fit, timing_score: timing, tier: fp ? 'C' : tier, likely_customer: fp ? `fingerprint ${fp.country} ${fp.hit}/${fp.total}` : '', score_reasons: reasons.join(' | ') };
}

const rows = files.flatMap((f) => parse(fs.readFileSync(f), { columns: true, skip_empty_lines: true, trim: true }));
const seen = new Set(); const ranked = [];
for (const r of rows) { const d = String(r.domain ?? '').toLowerCase(); if (!d || seen.has(d)) continue; seen.add(d); ranked.push({ ...r, ...score(r) }); }
ranked.sort((a, b) => b.score - a.score || b.timing_score - a.timing_score);
ranked.forEach((r, i) => { r.rank = i + 1; });
const lead = ['rank', 'tier', 'score', 'fit_score', 'timing_score', 'company', 'domain', 'hq_country', 'countries', 'segment', 'signal_type', 'signal', 'signal_date', 'signal_source_url', 'accounting_today', 'countries_with_no_local_ledger', 'coverage_gap', 'integrations_page_url', 'score_reasons'];
const cols = [...new Set([...lead, ...ranked.flatMap((r) => Object.keys(r))])];
fs.writeFileSync(outPath, stringify(ranked, { header: true, columns: cols }));
const count = (t) => ranked.filter((r) => r.tier === t).length;
console.log(`accounts: ${ranked.length}   A: ${count('A')}   B: ${count('B')}   C: ${count('C')}   → ${outPath}`);
for (const r of ranked.slice(0, 15)) console.log(`${String(r.rank).padStart(2)} ${r.tier} ${String(r.score).padStart(3)}  ${r.company} (${r.hq_country}) · ${r.signal_type} · acc: ${r.accounting_today || '-'} · no local: ${r.countries_with_no_local_ledger || '-'}`);
