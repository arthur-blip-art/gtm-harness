import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import { GTM_HOME, defaults } from '../config.ts';
import { openStore } from '../store/index.ts';
import { registry, providerTable } from '../providers/index.ts';
import { ToolRunner } from '../core/tools.ts';
import { exportCsv, loadCsv, summarizeCsv, toRowStates } from '../core/dataset.ts';
import { buildReceipt, renderReceipt } from '../core/receipt.ts';
import { BudgetExceeded } from '../core/waterfall.ts';
import { plays } from '../plays/index.ts';
import type { Cells, EmailCell } from '../core/types.ts';

const program = new Command();
program.name('gtm').description('Self-hosted GTM engine: waterfall enrichment with your own provider keys.').version('0.1.0');
const log = (m: string) => console.error(`[gtm] ${m}`);

program.command('providers').description('List providers, whether their key is configured, and their price basis.').action(() => {
  const rows = providerTable();
  console.log('| provider | configured | env | tools | pricing (credits) | verified |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.provider} | ${r.configured ? 'yes' : 'no'} | ${r.env} | ${r.tools} | ${r.pricing} | ${r.verifiedOn} |`);
  console.log(`\n.env location: ${path.join(GTM_HOME, '.env')}`);
});

program.command('plays').description('List available plays.').action(() => {
  for (const [name, p] of Object.entries(plays)) console.log(`${name}  —  ${p.DESCRIPTION}`);
});

program
  .command('run')
  .description('Run a play over a CSV. Pilot first (--limit 3), read the receipt, then the full file.')
  .argument('<play>', 'play name (see `gtm plays`)')
  .requiredOption('--csv <path>', 'input CSV')
  .requiredOption('--out <path>', 'output CSV (exact path requested by the user)')
  .option('--limit <n>', 'only the first n rows (pilot)', (v) => Number(v))
  .option('--dataset <slug>', 'dataset slug; defaults to the CSV basename')
  .option('--legs <ids>', 'comma-separated subset of legs, e.g. apollo,fullenrich')
  .option('--max-credits <n>', `abort when this run spends more (default ${defaults.maxCreditsPerRun})`, (v) => Number(v))
  .option('--refresh', 'ignore cached receipts and re-buy', false)
  .option('--dry-run', 'mock every provider, in-memory store, no keys needed', false)
  .option('--column <mapping...>', 'header override, e.g. --column domain=Website first_name=Prenom')
  .action(async (playName: string, o) => {
    const play = plays[playName as keyof typeof plays];
    if (!play) { console.error(`Unknown play ${playName}. Known: ${Object.keys(plays).join(', ')}`); process.exit(2); }
    const overrides: Record<string, string> = {};
    for (const m of o.column ?? []) { const [k, v] = String(m).split('='); if (k && v) overrides[k] = v; }

    const csv = loadCsv(o.csv, overrides, o.limit);
    if (!csv.rows.length) { console.error('CSV has no rows'); process.exit(2); }
    const slug = o.dataset ?? path.basename(o.csv).replace(/\.csv$/i, '');
    const store = openStore({ dryRun: o.dryRun });
    const runner = new ToolRunner(store, registry, { dryRun: o.dryRun, refresh: o.refresh, log });
    const maxCredits = o.maxCredits ?? defaults.maxCreditsPerRun;

    const dataset = await store.ensureDataset(slug, playName);
    const stored = await store.upsertRows(dataset.id, csv.rows.map((input) => ({ rowKey: toRowStates([input], new Map())[0].rowKey, input })));
    const existing = new Map<string, Cells>(stored.map((r) => [r.rowKey, r.cells]));
    const rows = toRowStates(csv.rows, existing);
    const alreadyDone = rows.filter((r) => (r.cells.email as EmailCell | undefined)?.value && !o.refresh);
    for (const r of alreadyDone) r.candidates.push({ email: (r.cells.email as EmailCell).value!, status: (r.cells.email as EmailCell).status ?? 'valid', source: (r.cells.email as EmailCell).source ?? 'cached' });
    const work = rows.filter((r) => !alreadyDone.includes(r) || (r.cells.email as EmailCell).confidence !== 'HIGH');

    const run = await store.createRun(playName, { csv: o.csv, out: o.out, limit: o.limit ?? null, legs: o.legs ?? null, dryRun: o.dryRun, refresh: o.refresh, maxCredits, cwd: process.cwd() }, dataset.id);
    log(`run ${run.id}  rows=${rows.length} (${alreadyDone.length} already had an email)  store=${store.kind}  cap=${maxCredits} credits`);

    let status: 'done' | 'aborted' | 'failed' = 'done';
    let notes: string | undefined;
    let metas = [] as Awaited<ReturnType<typeof play.run>>;
    try {
      metas = await play.run(work, runner, {
        runId: run.id, dryRun: o.dryRun, legs: o.legs ? String(o.legs).split(',') : undefined, maxCredits, log,
        onRowUpdated: (r) => store.saveCells(dataset.id, r.rowKey, r.cells),
      });
    } catch (e) {
      if (e instanceof BudgetExceeded) { status = 'aborted'; notes = e.message; log(e.message); }
      else { status = 'failed'; notes = e instanceof Error ? e.message : String(e); log(`FAILED: ${notes}`); }
    }
    for (const r of rows) await store.saveCells(dataset.id, r.rowKey, r.cells);
    if (status !== 'failed') await play.writeGolden(rows, store);

    const receipts = await store.listReceiptsByRun(run.id);
    const receipt = buildReceipt(run.id, rows.length, receipts, metas);
    const accepted = rows.filter((r) => ['HIGH', 'MEDIUM'].includes((r.cells.email as EmailCell)?.confidence)).length;
    await store.finishRun(run.id, { status, rowsIn: rows.length, rowsOut: accepted, totalCostCredits: receipt.totalCredits, totalCostUsd: receipt.totalUsd, receipt, notes });
    exportCsv(o.out, rows, [...play.LEG_IDS, 'verify'], run.id, csv.headers);

    const cached = receipts.filter((r) => r.cached).length;
    console.log(renderReceipt(receipt));
    console.log(`\nstatus: ${status}   receipts: ${receipts.length - cached} new / ${cached} cached   exported: ${o.out}`);
    console.log(`rows: ${rows.length}   sendable (HIGH+MEDIUM): ${accepted}   HOLD: ${rows.filter((r) => (r.cells.email as EmailCell)?.confidence === 'HOLD').length}   none: ${rows.filter((r) => !(r.cells.email as EmailCell)?.value).length}`);
    await store.close();
    if (status === 'failed') process.exit(1);
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

program
  .command('audit')
  .description('Run the Deepline validators (email/domain match, contact accuracy) on an exported CSV.')
  .requiredOption('--csv <path>')
  .option('--email-col <c>', 'email column', 'email')
  .option('--domain-col <c>', 'domain column', 'domain')
  .action((o) => {
    const script = path.join(GTM_HOME, 'scripts', 'validate-emails.py');
    const r = spawnSync('python3', [script, o.csv, '--email-col', o.emailCol, '--domain-col', o.domainCol], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  });

program.parseAsync(process.argv).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
