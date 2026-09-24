import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import { z } from 'zod';
import { GTM_HOME, defaults } from '../config.ts';
import { openStore } from '../store/index.ts';
import { providerTable } from '../providers/index.ts';
import { exportCsv, loadCsv, summarizeCsv } from '../core/dataset.ts';
import { renderReceipt } from '../core/receipt.ts';
import { executePlay } from '../core/run.ts';
import { plays, resolvePlay } from '../plays/index.ts';
import type { BatchOutput } from '../core/row-play.ts';
import type { FieldCell } from '../core/types.ts';

const program = new Command();
program.name('gtm').description('Self-hosted GTM engine: waterfall enrichment with your own provider keys.').version('0.2.0');
const log = (m: string) => console.error(`[gtm] ${m}`);

program.command('providers').description('List providers, whether their key is configured, and their price basis.').action(() => {
  console.log('| provider | configured | env | tools | pricing (credits) | verified |');
  console.log('|---|---|---|---|---|---|');
  for (const r of providerTable()) console.log(`| ${r.provider} | ${r.configured ? 'yes' : 'no'} | ${r.env} | ${r.tools} | ${r.pricing} | ${r.verifiedOn} |`);
  console.log(`\n.env location: ${path.join(GTM_HOME, '.env')}`);
});

program.command('plays').description('List plays with their input schema.').option('--json', 'machine-readable', false).action((o) => {
  const rows = Object.values(plays).map((p) => ({ name: p.name, kind: p.kind, description: p.description, input: z.toJSONSchema(p.input) }));
  if (o.json) return console.log(JSON.stringify(rows, null, 2));
  for (const r of rows) {
    const props = (r.input as any).properties ?? {};
    const req = new Set<string>((r.input as any).required ?? []);
    const fields = Object.keys(props).map((k) => (req.has(k) ? `${k}*` : k)).join(', ');
    console.log(`${r.name}  [${r.kind}]  —  ${r.description}\n    input: ${fields || '(none)'}`);
  }
});

program
  .command('run')
  .description('Run a play. Scalar: --input JSON. Batch: --csv + --out (pilot with --limit 3 first).')
  .argument('<play>', 'play name (see `gtm plays`)')
  .option('--input <json>', 'scalar input as JSON')
  .option('--csv <path>', 'input CSV (selects the :batch variant)')
  .option('--out <path>', 'output CSV (exact path requested by the user)')
  .option('--limit <n>', 'only the first n rows (pilot)', (v) => Number(v))
  .option('--dataset <slug>', 'dataset slug; defaults to the CSV basename')
  .option('--legs <ids>', 'comma-separated subset of legs, e.g. apollo,fullenrich')
  .option('--max-credits <n>', `abort when this run spends more (default ${defaults.maxCreditsPerRun})`, (v) => Number(v))
  .option('--refresh', 'ignore cached receipts and re-buy', false)
  .option('--dry-run', 'mock every provider, in-memory store, no keys needed', false)
  .option('--column <mapping...>', 'header override, e.g. --column domain=Website first_name=Prenom')
  .action(async (playName: string, o) => {
    const store = openStore({ dryRun: o.dryRun });
    const common = { store, resolvePlay, dryRun: o.dryRun, refresh: o.refresh, legs: o.legs ? String(o.legs).split(',') : undefined, maxCredits: o.maxCredits ?? defaults.maxCreditsPerRun, log };
    try {
      if (o.csv) {
        if (!o.out) throw new Error('--out is required with --csv');
        const overrides: Record<string, string> = {};
        for (const m of o.column ?? []) { const [k, v] = String(m).split('='); if (k && v) overrides[k] = v; }
        const csv = loadCsv(o.csv, overrides, o.limit);
        if (!csv.rows.length) throw new Error('CSV has no rows');
        const name = playName.endsWith(':batch') ? playName : `${playName}:batch`;
        const play = resolvePlay(name);
        const slug = o.dataset ?? path.basename(o.csv).replace(/\.csv$/i, '');
        const res = await executePlay<BatchOutput>({ ...common, play, input: { rows: csv.rows, slug }, inputSummary: { csv: o.csv, out: o.out, limit: o.limit ?? null } });
        if (res.output) {
          const { rows, legIds, field } = res.output;
          exportCsv(o.out, rows, legIds, res.runId, csv.headers, field);
          const conf = (r: (typeof rows)[number]) => (r.cells[field] as FieldCell | undefined)?.confidence;
          console.log(renderReceipt(res.receipt));
          console.log(`\nstatus: ${res.status}   receipts: ${res.newReceipts} new / ${res.cachedReceipts} cached   exported: ${o.out}`);
          console.log(`rows: ${rows.length}   sendable (HIGH+MEDIUM): ${rows.filter((r) => ['HIGH', 'MEDIUM'].includes(conf(r) ?? '')).length}   HOLD: ${rows.filter((r) => conf(r) === 'HOLD').length}   none: ${rows.filter((r) => !(r.cells[field] as FieldCell | undefined)?.value).length}`);
        } else {
          console.log(renderReceipt(res.receipt));
          console.log(`\nstatus: ${res.status}   ${res.notes ?? ''}`);
        }
        if (res.status === 'failed') process.exitCode = 1;
      } else {
        const play = resolvePlay(playName);
        const input = o.input ? JSON.parse(o.input) : {};
        const res = await executePlay({ ...common, play, input, inputSummary: { input } });
        console.log(JSON.stringify(res.output ?? null, null, 2));
        console.log('\n' + renderReceipt(res.receipt));
        console.log(`\nstatus: ${res.status}   receipts: ${res.newReceipts} new / ${res.cachedReceipts} cached${res.notes ? `   ${res.notes}` : ''}`);
        if (res.status === 'failed') process.exitCode = 1;
      }
    } finally {
      await store.close();
    }
  });

program.command('receipt').description('Print the frozen cost receipt of a run.').argument('<runId>').action(async (runId: string) => {
  const store = openStore({});
  const run = await store.getRun(runId);
  if (!run) { console.error('run not found'); process.exit(2); }
  console.log(run.receipt ? renderReceipt(run.receipt as never) : '(no receipt stored)');
  console.log(`\nstatus: ${run.status}  rows_in: ${run.rowsIn}  rows_out: ${run.rowsOut}  credits: ${run.totalCostCredits}  started: ${run.startedAt}`);
  await store.close();
});

const csvCmd = program.command('csv').description('Inspect a CSV without loading it into the conversation.');
csvCmd.command('show').requiredOption('--csv <path>').option('--summary', 'shape, detected columns, 2-row sample', true).action((o) => console.log(summarizeCsv(o.csv)));

const cache = program.command('cache').description('Receipt cache.');
cache.command('stats').action(async () => {
  const store = openStore({});
  const s = await store.receiptStats();
  console.log(`receipts: ${s.total}`);
  for (const [p, v] of Object.entries(s.byProvider)) console.log(`  ${p}: ${v.count} calls, ${v.credits} credits`);
  await store.close();
});

const db = program.command('db').description('Database.');
db.command('ping').description('List public tables (proves DATABASE_URL and migrations).').action(async () => {
  const store = openStore({});
  console.log((await store.ping()).join('\n'));
  await store.close();
});

// ---- prompts: Deepline's 181 Clay-style templates, placeholders normalised to {{label}}
type PromptFile = Record<string, string[] | string>;
function loadPrompts(): PromptFile {
  const p = path.join(GTM_HOME, 'prompts.json');
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as PromptFile) : {};
}
export function renderPrompt(raw: string | string[]): { text: string; vars: string[] } {
  let text = Array.isArray(raw) ? raw.join('') : raw;
  const vars = new Set<string>();
  // `" + {{input 1: Company Domain}} + "` → {{company_domain}} ; `{{Title}}` → {{title}}
  text = text.replace(/"?\s*\+\s*\{\{\s*(?:input\s*\d+\s*:)?\s*([^}]+?)\s*\}\}\s*\+\s*"?/g, (_m, label: string) => `{{${slug(label, vars)}}}`);
  text = text.replace(/\{\{\s*(?:input\s*\d+\s*:)?\s*([^}]+?)\s*\}\}/g, (_m, label: string) => `{{${slug(label, vars)}}}`);
  text = text.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\\"/g, '"');
  return { text, vars: [...vars] };
}
function slug(label: string, vars: Set<string>) {
  const s = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'input';
  vars.add(s);
  return s;
}
const THEMES: Array<[string, RegExp]> = [
  ['company research', /company|10-k|10k|funding|raised|domain|competitor|pricing|location|event|industry|parent|subsidiar|valuation|market cap|revenue|website|blog|careers|news|esg|naics|mission|values|customers|stealth|accelerator|portfolio|founding|fleet|energy|electricity|ppa/i],
  ['person', /person|linkedin|ceo|candidate|manager|graduat|school|skill|age|twitter handle|github|podcast|keynote|job|interview|title|bio|instagram/i],
  ['classification', /classify|determine|check if|is the company|saas|b2b|venture|retail|revenue model|rate website|keyword|email classification|data leak|free trial|demos/i],
  ['outreach copy', /email|first line|subject|connect message|outbound|personalization|p\.s|opening message|prospecting/i],
  ['cleaning', /clean|normaliz|extract city|json list|validate domain|domain validation|entity/i],
  ['calls', /gong|transcript|call/i],
];
const prompts = program.command('prompts').description('Prompt templates (Deepline/Clay collection, 181 keys).');
prompts.command('list').option('--theme <t>').action((o) => {
  const all = loadPrompts();
  const byTheme = new Map<string, string[]>();
  for (const key of Object.keys(all).sort()) {
    const theme = THEMES.find(([, re]) => re.test(key))?.[0] ?? 'other';
    (byTheme.get(theme) ?? byTheme.set(theme, []).get(theme)!).push(key);
  }
  for (const [theme, keys] of byTheme) {
    if (o.theme && theme !== o.theme) continue;
    console.log(`\n## ${theme} (${keys.length})`);
    for (const k of keys) console.log(`- ${k}`);
  }
  console.log(`\n${Object.keys(all).length} prompts. Show one: gtm prompts show "<key>"`);
});
prompts.command('show').argument('<key>').option('--raw', 'original Clay-style text', false).action((key: string, o) => {
  const all = loadPrompts();
  const hit = all[key] ?? all[Object.keys(all).find((k) => k.toLowerCase() === key.toLowerCase()) ?? ''];
  if (!hit) { console.error(`No prompt "${key}". Try: gtm prompts list`); process.exit(2); }
  if (o.raw) return console.log(Array.isArray(hit) ? hit.join('') : hit);
  const { text, vars } = renderPrompt(hit);
  console.log(`# ${key}\nvariables: ${vars.map((v) => `{{${v}}}`).join(', ') || '(none)'}\n\n${text}`);
});

program
  .command('audit')
  .description('Run the Deepline validators (email/domain match) on an exported CSV.')
  .requiredOption('--csv <path>')
  .option('--email-col <c>', 'email column', 'email')
  .option('--domain-col <c>', 'domain column', 'domain')
  .action((o) => {
    const r = spawnSync('python3', [path.join(GTM_HOME, 'scripts', 'validate-emails.py'), o.csv, '--email-col', o.emailCol, '--domain-col', o.domainCol], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  });

const signals = program.command('signals').description('Company signals (funding, jobs, headcount).');
signals.command('pull').description('Pull signals for a one-column file of domains (runs company-signals:batch).').requiredOption('--domains <path>').option('--dry-run', '', false).option('--max-credits <n>', '', (v) => Number(v)).action(async (o) => {
  const domains = fs.readFileSync(o.domains, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && s !== 'domain');
  const store = openStore({ dryRun: o.dryRun });
  try {
    const res = await executePlay({ store, resolvePlay, play: resolvePlay('company-signals:batch'), input: { rows: domains.map((domain) => ({ domain })), slug: path.basename(o.domains) }, dryRun: o.dryRun, maxCredits: o.maxCredits ?? defaults.maxCreditsPerRun, log });
    console.log(renderReceipt(res.receipt));
    console.log(`\nstatus: ${res.status}`);
  } finally {
    await store.close();
  }
});

if (!process.env.VITEST) {
  program.parseAsync(process.argv).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
