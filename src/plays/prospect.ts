import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { Input as IcpInput, play as icpToCompanies, type Output as IcpOutput } from './icp-to-companies.ts';
import { pullSignals } from './company-signals.ts';
import { play as scoreAccounts, type Output as ScoreOutput } from './score-accounts.ts';
import { play as companyToPeople, type Output as PeopleOutput } from './company-to-people.ts';
import { batch as emailBatch } from './name-domain-to-email.ts';
import { accountContext } from './account-context.ts';
import { draftSequence } from './draft-sequence.ts';
import { play as syncHubspot, type Output as SyncOutput } from './sync-hubspot.ts';
import type { BatchOutput } from '../core/row-play.ts';
import type { EmailCell } from '../core/types.ts';
import { timingScore } from '../core/signal-rules.ts';

export const NAME = 'prospect';
export const DESCRIPTION = 'The button: "find me the right people and prepare sequences". ICP → accounts (free sources first) → signals (free first) → scoring → the top N accounts → the right people → email cascade → one-page brief per account → a 3-step draft for the best contact. Writes accounts.csv, people.csv, briefs and sequences to out_dir. Drafts only; CRM push optional.';

export const Input = IcpInput.extend({
  titles: z.array(z.string()).min(1).describe('personas in order of preference, e.g. ["VP Sales","Head of RevOps","CEO"]'),
  offer: z.string().min(10).describe('what we sell, one proof, the step-1 offer (a resource, never a meeting)'),
  sender: z.string().default(''),
  language: z.enum(['fr', 'en']).default('en'),
  accounts: z.number().int().min(1).max(200).default(10).describe('accounts to work end to end'),
  people_per_account: z.number().int().min(1).max(5).default(2),
  paid_signals: z.enum(['never', 'gap', 'always']).default('never').describe('signals for ranking: free only by default'),
  out_dir: z.string().optional().describe('default gtm-data/prospect-<date>'),
  sync_hubspot: z.boolean().default(false),
});
export type Input = z.infer<typeof Input>;
export interface Output {
  out_dir: string; candidates: number; worked: number; people: number;
  emails: { high: number; medium: number; hold: number; none: number }; drafts: number; needs_review: number;
  accounts: Array<{ domain: string; name?: string; timing: number; timing_reasons: string[]; fit: number | null; engagement: number | null; why_now: string; people: number; drafts: string[] }>;
  sync?: SyncOutput;
}

export async function prospect(input: Input, ctx: PlayCtx): Promise<Output> {
  const { titles, offer, sender, language, accounts: n, people_per_account, paid_signals, out_dir, sync_hubspot, ...icp } = input;
  const outDir = out_dir ?? path.join('gtm-data', `prospect-${new Date().toISOString().slice(0, 10)}`);
  fs.mkdirSync(outDir, { recursive: true });

  // 1. accounts: over-provision (3x `accounts`, max 300) so ranking has room to choose; `accounts` drives the size, not `limit`
  const want = Math.min(Math.max(n * 3, n), 300);
  const found = await ctx.runPlay<z.infer<typeof IcpInput>, IcpOutput>(icpToCompanies, { ...icp, limit: want });
  const domains = found.companies.map((c) => c.domain);
  ctx.log(`${domains.length} candidate accounts`);
  if (!domains.length) { const empty: Output = { out_dir: outDir, candidates: 0, worked: 0, people: 0, emails: { high: 0, medium: 0, hold: 0, none: 0 }, drafts: 0, needs_review: 0, accounts: [] }; fs.writeFileSync(path.join(outDir, 'README.md'), renderSummary(empty, input)); return empty; }

  // 2. situation and timing, free first
  for (const c of found.companies) await pullSignals({ domain: c.domain, company: c.name || undefined, job_days: 90, news_days: 180, paid: paid_signals }, ctx);

  // 3. rank: timing first (fresh signals, transparent weights), then the scoring contract when it can score
  const scored = await ctx.runPlay<unknown, ScoreOutput>(scoreAccounts, { domains });
  const score = (d: string, dim: string) => scored.scores.find((s) => s.domain === d && s.dimension === dim)?.score ?? null;
  const signals = await ctx.store.listSignals(domains);
  const timing = new Map(domains.map((d) => [d, timingScore(signals.filter((s) => s.domain === d))]));
  const t = (d: string) => timing.get(d)?.score ?? 0;
  const ranked = [...found.companies].sort((a, b) => t(b.domain) - t(a.domain) || (score(b.domain, 'account_fit') ?? -1) - (score(a.domain, 'account_fit') ?? -1)).slice(0, n);

  // 4. people, then the email cascade over all of them at once (leg-major, cheapest first)
  const rows: Record<string, string>[] = [];
  for (const c of ranked) {
    const ppl = await ctx.runPlay<unknown, PeopleOutput>(companyToPeople, { domain: c.domain, company: c.name || undefined, titles, limit: people_per_account });
    for (const p of ppl.people) rows.push({ first_name: p.first_name, last_name: p.last_name, domain: c.domain, company: c.name ?? '', title: p.title ?? '', linkedin_url: p.linkedin_url ?? '', source: p.source });
  }
  const emails = rows.length ? await ctx.runPlay<unknown, BatchOutput>(emailBatch, { rows, slug: `${NAME}:${ctx.runId.slice(0, 8)}` }) : { rows: [] as BatchOutput['rows'] };
  const cellOf = (r: BatchOutput['rows'][number]) => r.cells.email as EmailCell | undefined;

  // 5. per account: the brief, then a draft for the best reachable contact
  const out: Output['accounts'] = [];
  let drafts = 0, review = 0;
  for (const c of ranked) {
    const ctxOut = await accountContext({ domain: c.domain, company: c.name || undefined, offer, news_days: 180, phone: true, llm: true, out_dir: path.join(outDir, 'accounts') }, ctx);
    const mine = emails.rows.filter((r) => r.input.domain === c.domain);
    const rankPerson = (r: (typeof mine)[number]) => (['HIGH', 'MEDIUM'].includes(cellOf(r)?.confidence ?? '') ? 0 : 10) + Math.max(0, titles.findIndex((t) => r.input.title?.toLowerCase().includes(t.toLowerCase())));
    const best = [...mine].sort((a, b) => rankPerson(a) - rankPerson(b))[0];
    const paths: string[] = [];
    if (best) {
      const seq = await draftSequence({ domain: c.domain, offer, sender, language, context: ctxOut, out_dir: path.join(outDir, 'sequences'), person: { first_name: best.input.first_name, last_name: best.input.last_name, title: best.input.title || undefined, email: cellOf(best)?.value ?? undefined, email_confidence: cellOf(best)?.confidence, linkedin_url: best.input.linkedin_url || undefined } }, ctx);
      drafts++;
      if (seq.status === 'needs_review') review++;
      if (seq.path) paths.push(seq.path);
    }
    out.push({ domain: c.domain, name: ctxOut.name, timing: t(c.domain), timing_reasons: timing.get(c.domain)?.reasons ?? [], fit: score(c.domain, 'account_fit'), engagement: score(c.domain, 'account_engagement'), why_now: ctxOut.summary.why_now, people: mine.length, drafts: paths });
  }

  // 6. files a human (or a sequencer import) can use as is
  fs.writeFileSync(path.join(outDir, 'accounts.csv'), stringify(out.map((a) => ({ domain: a.domain, name: a.name ?? '', timing: a.timing, timing_reasons: a.timing_reasons.join(' '), fit: a.fit ?? '', engagement: a.engagement ?? '', why_now: a.why_now, people: a.people, brief: path.join('accounts', `${a.domain}.md`), sequence: a.drafts[0] ? path.relative(outDir, a.drafts[0]) : '' })), { header: true }));
  fs.writeFileSync(path.join(outDir, 'people.csv'), stringify(emails.rows.map((r) => ({ first_name: r.input.first_name, last_name: r.input.last_name, title: r.input.title, company: r.input.company, domain: r.input.domain, linkedin_url: r.input.linkedin_url, found_by: r.input.source, email: cellOf(r)?.value ?? '', email_status: cellOf(r)?.status ?? '', confidence: cellOf(r)?.confidence ?? '' })), { header: true }));
  const conf = (k: string) => emails.rows.filter((r) => cellOf(r)?.confidence === k).length;
  const result: Output = { out_dir: outDir, candidates: domains.length, worked: ranked.length, people: rows.length, emails: { high: conf('HIGH'), medium: conf('MEDIUM'), hold: conf('HOLD'), none: emails.rows.filter((r) => !cellOf(r)?.value).length }, drafts, needs_review: review, accounts: out };
  fs.writeFileSync(path.join(outDir, 'README.md'), renderSummary(result, input));
  if (sync_hubspot) result.sync = await ctx.runPlay<unknown, SyncOutput>(syncHubspot, { domains: ranked.map((c) => c.domain) });
  return result;
}

function renderSummary(r: Output, i: Input): string {
  return [
    `# Prospecting run, ${new Date().toISOString().slice(0, 10)}`, '',
    `Personas: ${i.titles.join(', ')}. ${r.candidates} candidate accounts, ${r.worked} worked, ${r.people} people, emails HIGH ${r.emails.high} / MEDIUM ${r.emails.medium} / HOLD ${r.emails.hold} / none ${r.emails.none}. ${r.drafts} drafts, ${r.needs_review} need a review before sending.`, '',
    '| account | timing | signals | fit | why now | people | sequence |', '|---|---|---|---|---|---|---|',
    ...r.accounts.map((a) => `| [${a.name ?? a.domain}](accounts/${a.domain}.md) | ${a.timing} | ${a.timing_reasons.join(', ')} | ${a.fit ?? ''} | ${a.why_now.replace(/\|/g, '/').slice(0, 140)} | ${a.people} | ${a.drafts[0] ? `[draft](${path.relative(r.out_dir, a.drafts[0])})` : ''} |`),
    '', 'Nothing was sent. Each draft ends with the list of what to check before it goes out.', '',
  ].join('\n');
}

export const play = definePlay<Input, Output>({ name: NAME, description: DESCRIPTION, kind: 'pipeline', input: Input, run: prospect });
