import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { z } from 'zod';
import { GTM_HOME, defaults } from '../config.ts';
import { openStore } from '../store/index.ts';
import { providerTable } from '../providers/index.ts';
import { exportCsv, loadCsv, summarizeCsv } from '../core/dataset.ts';
import { renderReceipt } from '../core/receipt.ts';
import { AuditColumnError, auditCsv, renderAudit } from '../core/audit.ts';
import { executePlay } from '../core/run.ts';
import { estimateRun, renderEstimate } from '../core/estimate.ts';
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
  .option('--input <json>', 'scalar input as JSON, or @path/to/file.json')
  .option('--csv <path>', 'input CSV (selects the :batch variant)')
  .option('--out <path>', 'output CSV (exact path requested by the user)')
  .option('--limit <n>', 'only the first n rows (pilot)', (v) => Number(v))
  .option('--dataset <slug>', 'dataset slug; defaults to the CSV basename')
  .option('--legs <ids>', 'comma-separated subset of legs, e.g. apollo,fullenrich')
  .option('--max-usd <n>', `stop before any call that would take this run past $n (default $${defaults.maxUsdPerRun}, GTM_MAX_USD_PER_RUN)`, (v) => Number(v))
  .option('--max-credits <n>', 'legacy cap in provider credits, checked after each leg (prefer --max-usd)', (v) => Number(v))
  .option('--estimate', 'print the worst-case cost of this run without spending anything (dry-run structure, real prices)', false)
  .option('--refresh', 'ignore cached receipts and re-buy', false)
  .option('--dry-run', 'mock every provider, in-memory store, no keys needed', false)
  .option('--no-db', 'live providers, in-memory store: no Supabase needed, no receipt cache across runs')
  .option('--column <mapping...>', 'header override, e.g. --column domain=Website first_name=Prenom')
  .action(async (playName: string, o) => {
    if (o.estimate) {
      const legs = o.legs ? String(o.legs).split(',') : undefined;
      let est;
      if (o.csv) {
        const overrides: Record<string, string> = {};
        for (const m of o.column ?? []) { const [k, v] = String(m).split('='); if (k && v) overrides[k] = v; }
        const csv = loadCsv(o.csv, overrides, o.limit);
        const name = playName.endsWith(':batch') ? playName : `${playName}:batch`;
        est = await estimateRun({ play: resolvePlay(name), input: { rows: csv.rows, slug: 'estimate' }, resolvePlay, legs, log: () => {} });
      } else {
        const input = o.input ? JSON.parse(String(o.input).startsWith('@') ? fs.readFileSync(String(o.input).slice(1), 'utf8') : o.input) : {};
        est = await estimateRun({ play: resolvePlay(playName), input, resolvePlay, legs, log: () => {} });
      }
      console.log(renderEstimate(est));
      const cap = o.maxUsd ?? defaults.maxUsdPerRun;
      console.log(`\nrun cap: $${cap}${est.worstUsd > cap ? `   the worst case is above the cap: the run would stop at $${cap} (pass --max-usd ${Math.ceil(est.worstUsd)} to allow it)` : ''}`);
      return;
    }
    const store = openStore({ dryRun: o.dryRun, db: o.db });
    const common = { store, resolvePlay, dryRun: o.dryRun, refresh: o.refresh, legs: o.legs ? String(o.legs).split(',') : undefined, maxCredits: o.maxCredits, maxUsd: o.maxUsd ?? defaults.maxUsdPerRun, monthlyBudgetUsd: defaults.monthlyBudgetUsd, log };
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
        const input = o.input ? JSON.parse(String(o.input).startsWith('@') ? fs.readFileSync(String(o.input).slice(1), 'utf8') : o.input) : {};
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

program.command('budget').description('Month-to-date spend from the receipts ledger, by provider, against GTM_MONTHLY_BUDGET_USD.').action(async () => {
  const store = openStore({});
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const s = await store.spendSince(monthStart);
  const budget = defaults.monthlyBudgetUsd;
  console.log(`month-to-date (since ${monthStart.slice(0, 10)}): $${s.usd.toFixed(2)}${budget !== undefined ? ` of $${budget} (${Math.round((100 * s.usd) / budget)}%, $${Math.max(0, budget - s.usd).toFixed(2)} left)` : '   (no GTM_MONTHLY_BUDGET_USD set)'}`);
  console.log(`per-run cap: $${defaults.maxUsdPerRun} (GTM_MAX_USD_PER_RUN)\n`);
  console.log('| provider | spent $ |');
  console.log('|---|---|');
  for (const [p, usd] of Object.entries(s.byProvider).sort((a, b) => b[1] - a[1])) console.log(`| ${p} | ${usd.toFixed(3)} |`);
  await store.close();
});

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

program
  .command('audit')
  .description('Email/domain consistency check on an exported CSV (wrong-person and previous-employer candidates).')
  .requiredOption('--csv <path>')
  .option('--email-col <c>', 'email column', 'email')
  .option('--domain-col <c>', 'domain column', 'domain')
  .option('--name-col <c>', 'name column for display', 'full_name')
  .action((o) => {
    try {
      const a = auditCsv(o.csv, { emailCol: o.emailCol, domainCol: o.domainCol, nameCol: o.nameCol });
      console.log(renderAudit(a));
      process.exit(a.warning ? 1 : 0);
    } catch (e) {
      if (e instanceof AuditColumnError) { console.error(`Error: ${e.message}`); process.exit(2); }
      throw e;
    }
  });

const signals = program.command('signals').description('Company signals (funding, jobs, headcount).');
signals.command('pull').description('Pull signals for a one-column file of domains (runs company-signals:batch).').requiredOption('--domains <path>').option('--dry-run', '', false).option('--max-credits <n>', '', (v) => Number(v)).action(async (o) => {
  const domains = fs.readFileSync(o.domains, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && s !== 'domain');
  const store = openStore({ dryRun: o.dryRun });
  try {
    const res = await executePlay({ store, resolvePlay, play: resolvePlay('company-signals:batch'), input: { rows: domains.map((domain) => ({ domain })), slug: path.basename(o.domains) }, dryRun: o.dryRun, maxCredits: o.maxCredits, maxUsd: defaults.maxUsdPerRun, monthlyBudgetUsd: defaults.monthlyBudgetUsd, log });
    console.log(renderReceipt(res.receipt));
    console.log(`\nstatus: ${res.status}`);
  } finally {
    await store.close();
  }
});

if (!process.env.VITEST) {
  program.parseAsync(process.argv).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
