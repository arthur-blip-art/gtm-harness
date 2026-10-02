#!/usr/bin/env node
// Integrations-page signal: for each domain, find the public integrations page, list the
// financial software it names, and compute the accounting coverage gap against Chift's catalog.
// No paid provider: plain HTTP fetch + dictionary match, so every hit is checkable by eye.
//   node scripts/integrations-signal.mjs --csv accounts.csv --out accounts.signals.csv
//   node scripts/integrations-signal.mjs --domain adfin.com --countries FR,BE,DE
// CSV needs a `domain` column; optional `countries` column (comma/space separated ISO codes).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const catalogPath = opt('--catalog', path.join(root, 'gtm-data/chift-test/chift-catalog.json'));
const DEFAULT_COUNTRIES = (opt('--countries', 'FR,BE,NL,DE,ES') || '').split(/[,\s]+/).filter(Boolean);

// Software that is not in Chift's catalog file but tells us the account already builds integrations.
const EXTRA = { accounting: ['Xero', 'QuickBooks', 'NetSuite', 'Sage', 'Sage Intacct', 'FreeAgent', 'MYOB', 'Zoho Books', 'Wave', 'Microsoft Dynamics', 'Business Central', 'SAP', 'Odoo', 'Cegid', 'DATEV', 'Exact Online', 'Pennylane', 'Lexoffice', 'Lexware', 'sevDesk', 'Holded', 'Fortnox', 'Visma', 'Twinfield', 'Moneybird', 'WinBooks', 'Yuki', 'Octopus', 'Tiime', 'Quadratus', 'ACD', 'EBP', 'MyUnisoft', 'Inqom', 'Dougs', 'A3ERP', 'Contasol', 'Billy', 'e-conomic', 'Tripletex', 'AFAS', 'SnelStart', 'Xledger', 'Unit4'] };

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function loadCatalog() {
  if (!fs.existsSync(catalogPath)) return { categories: EXTRA, local: {}, fallback: true };
  const c = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const cats = {};
  for (const [k, list] of Object.entries(c.categories ?? {})) cats[k] = list.map((x) => (typeof x === 'string' ? x : x.name));
  // Add generic ledgers the catalog file does not list, unless the catalog already has them under another label.
  const have = new Set((cats.accounting ?? []).flatMap((n) => [n, ...(ALIAS[n] ?? [])]).map(norm));
  cats.accounting = [...(cats.accounting ?? []), ...EXTRA.accounting.filter((n) => !have.has(norm(n)))];
  // The gap that matters in copy is local software: "you sell in France and cover no French ledger".
  return { categories: cats, local: c.accounting_by_country_local_only ?? c.accounting_by_country ?? {}, fallback: false };
}
// Catalog labels → how the name is actually written on a vendor's page.
const ALIAS = { Acd: ['ACD'], 'Afas Software': ['AFAS'], 'Dinero by Visma': ['Dinero'], 'Dynamics 365 Business Central': ['Business Central', 'Dynamics 365'], 'e-Boekhouden.nl': ['e-Boekhouden', 'eBoekhouden'], 'E-conomic by Visma': ['e-conomic', 'economic'], Exact: ['Exact Online', 'Exact'], 'Finago Procountor': ['Procountor'], 'InexWeb - In Extenso': ['InexWeb', 'Inexweb'], 'Lexware Office': ['Lexware', 'lexoffice'], 'Oracle NetSuite': ['NetSuite'], Quickbooks: ['QuickBooks'], 'Sage 100 FR': ['Sage 100'], 'Sage 200 ES': ['Sage 200'], 'Sage 50 Accounts UK': ['Sage 50'], 'Sage 50 Cloud ES': ['Sage 50'], 'Sage 50 FR': ['Sage 50'], 'Sage BOB50': ['BOB50', 'Sage BOB', 'BOB 50'], 'Sage Génération Experts': ['Génération Experts', 'Generation Experts'], 'Sevdesk by Cegid': ['sevDesk'], 'TeamSystem Reviso': ['Reviso'], 'TeamSystem Fatture in Cloud': ['Fatture in Cloud'], 'Square (Payment)': ['Square'], 'Zettle (Payment)': ['Zettle'], 'Shopify Payment': ['Shopify Payments'], 'Last.app': ['Last.app'] };
// Dictionary words and acronyms only count when written with their brand casing.
const CASED = new Set(['Exact', 'Wave', 'Billy', 'Horus', 'Octopus', 'Square', 'Sage', 'Yuki', 'Dinero', 'Toast', 'Clover', 'Agora', 'Jalia', 'Tiller', 'Thais', 'Wavy', 'Tink', 'Harvest', 'Fuga', 'Boond', 'Zoho', 'Stripe', 'Amazon', 'Ponto', 'Minox', 'Quipu', 'Spiris', 'Fiken', 'Mews', 'Noovy', 'Lightspeed', 'ACD', 'EBP', 'SAP', 'AFAS', 'LEO2', 'Abill', 'economic', 'Qonto', 'Fulll', 'Tiime', 'Visma', 'Unit4', 'Cegid']);
const catalog = loadCatalog();
const variants = (name) => [...new Set(ALIAS[name] ?? [name])];
const tester = (v) => (CASED.has(v) || v.length <= 3
  ? { cased: true, re: new RegExp(`(^|[^A-Za-z0-9])${esc(v)}([^A-Za-z0-9]|$)`) }
  : { cased: false, re: new RegExp(`(^|[^a-z0-9])${esc(norm(v)).replace(/\s+/g, '[\\s-]?')}([^a-z0-9]|$)`) });
const matchers = Object.entries(catalog.categories).flatMap(([cat, names]) => names.map((name) => ({ cat, name, tests: variants(name).map(tester) })));
const present = (m, t) => m.tests.some((x) => x.re.test(x.cased ? t.raw : t.low));
// Brand families: a page that says "Sage" or "Cegid" may cover any product of the family, so we never
// claim a gap on it. The gap only lists software whose whole family is absent from the page.
const family = (name) => (/^Sage\b/.test(name) ? 'Sage' : /Cegid/.test(name) ? 'Cegid' : /Visma/.test(name) ? 'Visma' : null);
const familyPresent = (name, t) => { const f = family(name); return f ? new RegExp(`(^|[^A-Za-z0-9])${f}([^A-Za-z0-9]|$)`).test(t.raw) : false; };

// A unified-API vendor named in the page source means the account is already a customer of Chift or of a competitor.
const VENDOR_TRACES = { chift: /chift\.(eu|app)|powered by chift|["'\/ ]chift["'\/ .-]/i, codat: /codat\.io|link\.codat/i, merge: /merge\.dev|cdn\.merge/i, apideck: /apideck\.com|unify\.apideck/i, rutter: /rutter\.com|rutterapi/i, maesn: /maesn\.(com|io)/i };
const PATHS = ['/integrations', '/en/integrations', '/fr/integrations', '/integrations/', '/marketplace', '/apps', '/app-store', '/connect', '/partners', '/en/partners', '/ecosystem', '/connectors', '/features/integrations', '/product/integrations', '/platform/integrations'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
async function get(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { status: res.status };
    return { status: res.status, url: res.url, html: await res.text() };
  } catch (e) { return { status: 0, error: String(e.message ?? e).slice(0, 80) }; }
}
function textOf(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
  const attrs = [...html.matchAll(/(?:alt|title|aria-label)="([^"]{2,80})"/gi)].map((m) => m[1]).join(' | ');
  const files = [...html.matchAll(/(?:src|href)="[^"]*?([a-z0-9-]{4,40})\.(?:svg|png|webp)"/gi)].map((m) => m[1].replace(/-/g, ' ')).join(' | ');
  const raw = `${body} | ${attrs}`;
  return { raw, low: norm(`${raw} | ${files}`) };
}

async function findPage(domain) {
  const base = `https://${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
  const home = await get(base);
  const candidates = [...PATHS];
  if (home.html) for (const m of home.html.matchAll(/href="([^"#?]*(?:integration|marketplace|connect|app-store|partner|ecosyst)[^"#?]*)"/gi)) { const h = m[1]; candidates.unshift(h.startsWith('http') ? h : h.startsWith('/') ? h : `/${h}`); }
  const seen = new Set(); let best = null; let blocked = home.status === 403 || home.status === 0;
  const traces = new Set(); const sniff = (html) => { for (const [k, re] of Object.entries(VENDOR_TRACES)) if (re.test(html)) traces.add(k); };
  if (home.html) sniff(home.html);
  for (const c of candidates.slice(0, 24)) {
    const url = c.startsWith('http') ? c : base + c;
    if (seen.has(url)) continue; seen.add(url);
    if (c.startsWith('http') && !url.includes(domain.split('.').slice(-2).join('.'))) continue;
    const r = await get(url);
    if (r.status === 403) blocked = true;
    if (!r.html || r.html.length < 2000) continue;
    sniff(r.html);
    const t = textOf(r.html);
    const hits = matchers.filter((m) => present(m, t));
    if (!best || hits.length > best.hits.length) best = { url: r.url ?? url, hits, size: r.html.length, t };
    if (best.hits.length >= 8) break;
  }
  return { best, blocked, traces: [...traces] };
}

async function analyse(domain, countries) {
  const { best, blocked, traces } = await findPage(domain);
  if (!best) return { domain, integrations_status: blocked ? 'blocked' : 'no_page_found', unified_api_trace: traces.join(' ') };
  const by = {}; for (const h of best.hits) (by[h.cat] ??= new Set()).add(h.name);
  const acc = [...(by.accounting ?? [])].sort();
  const all = [...new Set(best.hits.map((h) => h.name))].sort();
  // Conservative gap: a local ledger counts as missing only if neither it nor its brand family is on the page.
  const wanted = [...new Set(countries.flatMap((c) => catalog.local[c] ?? []))];
  const accMatchers = matchers.filter((m) => m.cat === 'accounting');
  const gap = all.length === 0 ? [] : wanted.filter((n) => { const m = accMatchers.find((x) => x.name === n); return m && !present(m, best.t) && !familyPresent(n, best.t); });
  // A ledger tagged in several countries only counts as "local" in its home market: Exact covering the Netherlands
  // does not mean German or French SMEs are served (they run DATEV, Lexware, Pennylane, Sage).
  const HOME = { Exact: ['NL', 'BE'], Pennylane: ['FR'], 'TeamSystem Reviso': [] };
  const localOf = (c) => (catalog.local[c] ?? []).filter((n) => !HOME[n] || HOME[n].includes(c));
  const gapCountries = all.length === 0 ? [] : countries.filter((c) => localOf(c).length && localOf(c).every((n) => gap.includes(n)));
  return {
    domain, integrations_status: all.length ? 'found' : 'page_without_known_names', integrations_page_url: best.url,
    integrations_count: all.length, integrations_today: all.join(', '), accounting_count: acc.length, accounting_today: acc.join(', '),
    coverage_gap: gap.slice(0, 14).join(', '), coverage_gap_count: gap.length, countries_with_no_local_ledger: gapCountries.join(' '), countries_checked: countries.join(' '), unified_api_trace: traces.join(' '),
  };
}

const single = opt('--domain');
if (single) { console.log(JSON.stringify(await analyse(single, DEFAULT_COUNTRIES), null, 2)); process.exit(0); }
const csvPath = opt('--csv'); const outPath = opt('--out');
if (!csvPath || !outPath) { console.error('usage: integrations-signal.mjs --csv in.csv --out out.csv | --domain x.com [--countries FR,BE]'); process.exit(2); }
const rows = parse(fs.readFileSync(csvPath), { columns: true, skip_empty_lines: true, trim: true });
// One dropped connection must not lose the run: swallow socket errors, checkpoint after every domain, resume from the checkpoint.
process.on('uncaughtException', (e) => { if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|UND_ERR|socket|terminated|aborted/i.test(`${e.code ?? ''} ${e.message ?? ''}`)) { console.error(`network error ignored: ${e.code ?? e.message}`); return; } throw e; });
process.on('unhandledRejection', (e) => console.error(`rejection ignored: ${String(e?.message ?? e).slice(0, 80)}`));
const ckPath = `${outPath}.checkpoint.json`;
const cache = new Map(fs.existsSync(ckPath) ? Object.entries(JSON.parse(fs.readFileSync(ckPath, 'utf8'))) : []);
const save = () => fs.writeFileSync(ckPath, JSON.stringify(Object.fromEntries(cache)));
const withTimeout = (p, ms, domain) => Promise.race([p, new Promise((res) => setTimeout(() => res({ domain, integrations_status: 'timeout' }), ms))]);
const todo = [...new Map(rows.filter((r) => r.domain).map((r) => [String(r.domain).toLowerCase(), r])).entries()].filter(([d]) => !cache.has(d));
if (cache.size) console.error(`resuming: ${cache.size} domain(s) already in checkpoint, ${todo.length} to go`);
let cursor = 0;
async function worker() {
  while (cursor < todo.length) {
    const [d, r] = todo[cursor++];
    const countries = r.countries ? String(r.countries).split(/[,\s]+/).filter(Boolean) : DEFAULT_COUNTRIES;
    let a; try { a = await withTimeout(analyse(d, countries), 90000, d); } catch (e) { a = { domain: d, integrations_status: 'error' }; }
    cache.set(d, a); save();
    console.error(`${d}: ${a.integrations_status}${a.accounting_today ? ` · accounting: ${a.accounting_today}` : ''}`);
  }
}
await Promise.all(Array.from({ length: Number(opt('--concurrency', 6)) }, worker));
const out = rows.map((r) => ({ ...r, ...(cache.get(String(r.domain ?? '').toLowerCase()) ?? {}) }));
const cols = [...new Set(out.flatMap((r) => Object.keys(r)))];
fs.writeFileSync(outPath, stringify(out, { header: true, columns: cols }));
const s = [...cache.values()];
fs.rmSync(ckPath, { force: true });
console.log(`domains: ${s.length}   found: ${s.filter((x) => x.integrations_status === 'found').length}   blocked: ${s.filter((x) => x.integrations_status === 'blocked').length}   no page: ${s.filter((x) => x.integrations_status === 'no_page_found').length}   catalog: ${catalog.fallback ? 'fallback dictionary (chift-catalog.json missing)' : catalogPath}   → ${outPath}`);
