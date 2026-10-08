import path from 'node:path';
import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { sha256 } from '../core/hash.ts';
import { normalizeLinkedin } from '../core/normalize.ts';
import { isFresh } from '../core/signal-rules.ts';
import { resolveDomain } from '../core/resolve-domain.ts';
import { createNotifier } from '../core/notify.ts';
import type { Signal } from '../store/store.ts';
import type { BatchOutput } from '../core/row-play.ts';
import type { EmailCell } from '../core/types.ts';
import { play as companyToPeople, type Output as PeopleOutput, type PersonHit } from './company-to-people.ts';
import { batch as emailBatch } from './name-domain-to-email.ts';
import { accountContext } from './account-context.ts';
import { draftSequence, type Output as SequenceOutput } from './draft-sequence.ts';

export const NAME = 'signal-to-action';
export const DESCRIPTION = 'The cascade a signal triggers, unattended: fresh signals since N days (funding, new executive, champion job change, competitor engager, expansion…) → the right people at the account (company-to-people, or the person the signal names) → email cascade → account context → a 3-step draft that opens on the signal. Each signal is actioned once. Drafts only: nothing is sent.';

export const Input = z.object({
  since_days: z.number().int().min(1).max(365).default(30).describe('signals observed within N days; each is actioned once, and only while within its shelf life'),
  types: z.array(z.string()).default(['funding_round', 'leadership_change', 'job_change', 'acquisition', 'expansion', 'product_launch', 'linkedin_competitor_engagement', 'linkedin_keyword_post']),
  titles: z.array(z.string()).min(1).describe('personas to reach at a company-level signal, in order of preference'),
  offer: z.string().min(10),
  sender: z.string().default(''),
  language: z.enum(['fr', 'en']).default('en'),
  max_accounts: z.number().int().min(1).max(100).default(10),
  people_per_account: z.number().int().min(1).max(5).default(2),
  out_dir: z.string().optional().describe('default gtm-data/actions/<date>'),
  notify: z.boolean().default(false),
});
export type Input = z.infer<typeof Input>;
export interface Action { signal: { type: string; domain: string; title: string; url: string; date?: string }; domain: string | null; people: number; emails_sendable: number; drafts: string[]; status: 'drafted' | 'no_people' | 'no_domain' | 'skipped' }
export interface Output { signals_seen: number; actioned: number; actions: Action[]; out_dir: string }

const PRIORITY = ['job_change', 'funding_round', 'leadership_change', 'acquisition', 'expansion', 'linkedin_competitor_engagement', 'product_launch', 'linkedin_keyword_post'];
const isCompanyDomain = (d: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(d) && !d.includes(':');
const factOf = (s: Signal) => {
  const v = s.value as any;
  const title = v.title ?? (s.type === 'job_change' ? `${v.name} joined ${v.to_company} as ${v.title}` : s.type === 'linkedin_competitor_engagement' ? `${v.engager} ${v.kind === 'comment' ? 'commented on' : 'reacted to'} a ${v.competitor} post` : v.excerpt ?? s.type);
  return { type: s.type, fact: String(title), source_url: String(v.url ?? v.post_url ?? v.profile ?? ''), date: s.observedAt };
};
const splitName = (n: string) => { const w = String(n ?? '').trim().split(/\s+/); return { first_name: w[0] ?? '', last_name: w.slice(1).join(' ') }; };
const companyFromTitle = (t: string) => /\b(?:at|chez|@)\s+(.+)$/i.exec(t ?? '')?.[1]?.trim() ?? null;

export async function signalToAction(input: Input, ctx: PlayCtx): Promise<Output> {
  const since = new Date(Date.now() - input.since_days * 86400000).toISOString();
  const outDir = input.out_dir ?? path.join('gtm-data', 'actions', new Date().toISOString().slice(0, 10));
  const all = await ctx.store.listRecentSignals(since, input.types);
  const done = new Set((await ctx.store.listRecentSignals('1970-01-01T00:00:00Z', ['action_taken'])).map((s) => String((s.value as any).signal)));
  const fresh = all.filter((s) => !done.has(s.dedupeKey) && isFresh(s.type, s.observedAt) && ((s.value as any).icp_match !== false));
  const rank = (s: Signal) => (PRIORITY.indexOf(s.type) === -1 ? 99 : PRIORITY.indexOf(s.type));

  // One action per account: its strongest signal. Person-level signals carry the person.
  const byKey = new Map<string, Signal>();
  for (const s of fresh.sort((a, b) => rank(a) - rank(b) || (b.observedAt ?? '').localeCompare(a.observedAt ?? ''))) {
    const v = s.value as any;
    const k = isCompanyDomain(s.domain) ? s.domain : normalizeLinkedin(v.engager_linkedin ?? v.author_linkedin ?? v.profile) ?? s.dedupeKey;
    if (!byKey.has(k)) byKey.set(k, s);
  }
  const queue = [...byKey.values()].slice(0, input.max_accounts);
  ctx.log(`${all.length} signals since ${since.slice(0, 10)}, ${fresh.length} fresh and not actioned, ${queue.length} accounts to work`);

  const actions: Action[] = [];
  for (const s of queue) {
    const v = s.value as any;
    const f = factOf(s);
    const action: Action = { signal: { type: s.type, domain: s.domain, title: f.fact, url: f.source_url, date: s.observedAt }, domain: null, people: 0, emails_sendable: 0, drafts: [], status: 'skipped' };
    actions.push(action);

    // Who: the person the signal names, or the personas at the account
    let domain = isCompanyDomain(s.domain) ? s.domain : null;
    let people: PersonHit[] = [];
    if (s.type === 'job_change' || s.type.startsWith('linkedin_')) {
      const name = s.type === 'job_change' ? v.name : v.engager ?? v.author;
      const title = s.type === 'job_change' ? v.title : v.engager_title ?? v.author_title;
      const company = s.type === 'job_change' ? v.to_company : v.author_company ?? companyFromTitle(title);
      if (!domain && company) domain = (await resolveDomain(ctx, company))?.domain ?? null;
      if (domain && name) people = [{ ...splitName(name), title: title ?? undefined, linkedin_url: normalizeLinkedin(v.engager_linkedin ?? v.author_linkedin ?? v.profile) ?? undefined, domain, source: `signal:${s.type}` }];
    } else if (domain) {
      people = (await ctx.runPlay<unknown, PeopleOutput>(companyToPeople, { domain, titles: input.titles, limit: input.people_per_account })).people;
    }
    action.domain = domain;
    if (!domain) { action.status = 'no_domain'; continue; }
    if (!people.length) { action.status = 'no_people'; continue; }

    // Reach: the email cascade, cost-ordered, cached
    const rows = people.filter((p) => p.first_name && p.last_name).map((p) => ({ first_name: p.first_name, last_name: p.last_name, domain, title: p.title ?? '', linkedin_url: p.linkedin_url ?? '' }));
    const emails = await ctx.runPlay<unknown, BatchOutput>(emailBatch, { rows, slug: `${NAME}:${domain}` });
    action.people = rows.length;

    // Context once per account, then one draft per person, opening on the signal
    const context = await accountContext({ domain, offer: input.offer, news_days: 180, phone: true, llm: true, out_dir: path.join(outDir, 'accounts') }, ctx);
    for (const r of emails.rows) {
      const cell = r.cells.email as EmailCell | undefined;
      if (['HIGH', 'MEDIUM'].includes(cell?.confidence ?? '')) action.emails_sendable++;
      const seq: SequenceOutput = await draftSequence({
        domain, offer: input.offer, sender: input.sender, language: input.language, context, signal: f, out_dir: path.join(outDir, 'sequences'),
        person: { first_name: r.input.first_name, last_name: r.input.last_name, title: r.input.title || undefined, email: cell?.value ?? undefined, email_confidence: cell?.confidence, linkedin_url: r.input.linkedin_url || undefined },
      }, ctx);
      if (seq.path) action.drafts.push(seq.path);
    }
    action.status = 'drafted';
    await ctx.store.upsertSignals([{ dedupeKey: sha256(`action|${s.dedupeKey}`).slice(0, 32), domain: s.domain, type: 'action_taken', source: NAME, observedAt: new Date().toISOString(), value: { signal: s.dedupeKey, run: ctx.runId, drafts: action.drafts } }]);
  }

  const actioned = actions.filter((a) => a.status === 'drafted').length;
  if (input.notify && actioned) {
    await createNotifier({ dryRun: ctx.dryRun, log: ctx.log }).slack(`Signal to action: ${actioned} accounts drafted (${actions.reduce((n, a) => n + a.drafts.length, 0)} sequences to review in ${outDir})\n${actions.filter((a) => a.status === 'drafted').map((a) => `• ${a.domain}: ${a.signal.type}, ${a.signal.title.slice(0, 100)}`).join('\n')}`);
  }
  return { signals_seen: all.length, actioned, actions, out_dir: outDir };
}

export const play = definePlay<Input, Output>({ name: NAME, description: DESCRIPTION, kind: 'pipeline', input: Input, run: signalToAction });

