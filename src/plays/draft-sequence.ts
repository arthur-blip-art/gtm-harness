import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { definePlay, type PlayCtx } from '../core/play.ts';
import { apexDomain } from '../core/normalize.ts';
import { callLeg, canRun } from '../core/leg.ts';
import { auditSequence, type Check, type Step } from '../core/copy-audit.ts';
import { isFresh } from '../core/signal-rules.ts';
import { renderSequence } from '../core/brief.ts';
import { accountContext, type Fact, type Output as Context } from './account-context.ts';

export const NAME = 'draft-sequence';
export const DESCRIPTION = 'A 3-step outbound draft for one person (email, LinkedIn, follow-up) built on the strongest dated fact of the account, each claim tied to a source URL, then the copy audit run by code. Never sends: the output is a draft with the exact list of what a human must check.';

export const Person = z.object({
  first_name: z.string().min(1), last_name: z.string().min(1), title: z.string().optional(),
  email: z.string().optional(), email_confidence: z.string().optional(), linkedin_url: z.string().optional(),
});
export const Input = z.object({
  domain: z.string().min(1),
  person: Person,
  offer: z.string().min(10).describe('what we sell, the proof (one customer, one number) and the low-commitment offer for step 1'),
  sender: z.string().default('').describe('signature, e.g. "Arthur, Acme"'),
  language: z.enum(['fr', 'en']).default('en'),
  context: z.any().optional().describe('account-context output; computed when absent'),
  signal: z.object({ type: z.string(), fact: z.string(), source_url: z.string(), date: z.string().optional() }).optional().describe('the trigger that started this draft, when it came from signal-to-action'),
  out_dir: z.string().optional(),
});
export type Input = z.infer<typeof Input>;
export interface Output {
  domain: string; company: string; person: z.infer<typeof Person>; status: 'draft' | 'needs_review';
  first_line_fact: Fact; steps: Step[]; audit: { score: number; checks: Check[] }; needs_review: string[]; by: 'llm' | 'template'; path?: string;
}

const PRIORITY = ['funding_round', 'leadership_change', 'acquisition', 'expansion', 'product_launch', 'partnership', 'jobs', 'job_opening', 'tech', 'integrations', 'customers', 'pricing', 'site'];

/** The strongest fact: a fresh dated event first, then hiring, then what their own pages say. */
export function strongestFact(facts: Fact[], signal?: Input['signal']): Fact {
  if (signal) return { fact: signal.fact, source_url: signal.source_url, date: signal.date ?? null, kind: signal.type };
  const ranked = facts
    .filter((f) => !f.date || isFresh(f.kind, f.date) || f.kind === 'jobs')
    .sort((a, b) => (PRIORITY.indexOf(a.kind) === -1 ? 99 : PRIORITY.indexOf(a.kind)) - (PRIORITY.indexOf(b.kind) === -1 ? 99 : PRIORITY.indexOf(b.kind)) || (b.date ?? '').localeCompare(a.date ?? ''));
  return ranked[0] ?? { fact: 'no specific fact found', source_url: '', kind: 'none' };
}

const SEQ_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['steps', 'claims'],
  properties: {
    steps: { type: 'array', description: 'Exactly 3 steps.', items: { type: 'object', additionalProperties: false, required: ['step', 'channel', 'subject', 'body'], properties: { step: { type: 'integer' }, channel: { type: 'string', enum: ['email', 'linkedin'] }, subject: { type: 'string', description: 'Empty string for LinkedIn.' }, body: { type: 'string' } } } },
    claims: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'source_url'], properties: { claim: { type: 'string' }, source_url: { type: 'string' } } }, description: 'Every factual statement about the prospect used in the copy, with the URL it comes from.' },
  },
} as const;

const RULES = (lang: 'fr' | 'en') => `Write a 3-step outbound sequence in ${lang === 'fr' ? 'French (vouvoiement)' : 'English'}.
Step 1: email, max 120 words, subject 6 words max in sentence case. Open on the given first-line fact and name where it comes from. Then one sentence on what it likely costs this persona. Then what we do in one sentence. Then one low-commitment offer (a resource, a benchmark, an answer), never a meeting. End with the opt-out line: ${lang === 'fr' ? '"Pas la bonne personne ? Dites-le-moi et je ne vous écrirai plus."' : '"Not the right person? Tell me and I won\'t write again."'}
Step 2: LinkedIn message, max 60 words, empty subject, references step 1 lightly, may ask for a short call.
Step 3: email follow-up, max 150 words, a second angle from another fact, then a simple question.
Rules: no em or en dash; no rhetorical question as the first sentence; no compliment without a fact; no jargon (leverage, seamless, robust, game-changer, innovative, holistic, best-in-class, empower, streamline, unlock); the body does not start with "I"; one number and one reference per message; never a price; use only the facts given and list each one you used in "claims" with its exact source URL.`;

function templateSteps(i: Input, fact: Fact, company: string): Step[] {
  const fr = i.language === 'fr';
  const first = i.person.first_name;
  const offerLine = i.offer.split(/(?<=[.!?])\s/)[0];
  return [
    { step: 1, channel: 'email', subject: fr ? `${company} et ${fact.kind.replace('_', ' ')}` : `${company} and ${fact.kind.replace('_', ' ')}`, body: fr
      ? `Bonjour ${first},\n\nVu sur ${fact.source_url} : ${fact.fact.slice(0, 160)}.\n\n${offerLine}\n\nSi utile, je vous envoie la ressource qui va avec.\n\nPas la bonne personne ? Dites-le-moi et je ne vous écrirai plus.\n${i.sender}`
      : `Hi ${first},\n\nSaw on ${fact.source_url}: ${fact.fact.slice(0, 160)}.\n\n${offerLine}\n\nHappy to send the resource that goes with it.\n\nNot the right person? Tell me and I won't write again.\n${i.sender}` },
    { step: 2, channel: 'linkedin', subject: null, body: fr ? `Bonjour ${first}, je vous ai écrit au sujet de ${company}. Ouvert à en parler 15 minutes ?` : `Hi ${first}, I wrote to you about ${company}. Open to a 15 minute chat?` },
    { step: 3, channel: 'email', subject: fr ? `Suite pour ${company}` : `Following up on ${company}`, body: fr ? `Bonjour ${first},\n\nUne autre piste : ${offerLine}\n\nEst-ce un sujet chez ${company} ce trimestre ?\n${i.sender}` : `Hi ${first},\n\nAnother angle: ${offerLine}\n\nIs this on the table at ${company} this quarter?\n${i.sender}` },
  ];
}

export async function draftSequence(input: Input, ctx: PlayCtx): Promise<Output> {
  const domain = apexDomain(input.domain) ?? input.domain;
  const context: Context = input.context ?? (await accountContext({ domain, offer: input.offer, news_days: 180, phone: false, llm: true }, ctx));
  const fact = strongestFact(context.facts, input.signal);
  const review: string[] = [];
  let steps: Step[];
  let by: Output['by'] = 'template';
  let claims: Array<{ claim: string; source_url: string }> = [];

  if (canRun(ctx, 'llm')) {
    const facts = [fact, ...context.facts.filter((f) => f !== fact).slice(0, 12)];
    const rc = await callLeg(ctx, 'llm:sequence', 'llm', 'generate', {
      task: 'sequence', effort: 'medium',
      system: 'You write cold outbound for a B2B seller. Accuracy first: a claim not in the facts is a failure. Short, concrete, polite, specific to this person.',
      prompt: `${RULES(input.language)}\n\nProspect: ${input.person.first_name} ${input.person.last_name}, ${input.person.title ?? 'role unknown'} at ${context.name} (${domain}).\nAccount summary: ${context.summary.one_liner}. Why now: ${context.summary.why_now}.\n\nFirst-line fact (use it in step 1): ${fact.fact} [source: ${fact.source_url}${fact.date ? `, ${fact.date.slice(0, 10)}` : ''}]\n\nOther facts:\n${facts.slice(1).map((f) => `- (${f.kind}) ${f.fact} [source: ${f.source_url}]`).join('\n')}\n\nWhat we sell:\n${input.offer}\n\nSignature: ${input.sender || '(none)'}`,
      schema: SEQ_SCHEMA,
    });
    const r = rc?.status === 'hit' ? ((rc.output as any).result as { steps: Step[]; claims: typeof claims }) : null;
    if (r?.steps?.length === 3) { steps = r.steps.map((st) => ({ ...st, subject: st.channel === 'linkedin' || !st.subject ? null : st.subject })); claims = r.claims ?? []; by = 'llm'; } else { steps = templateSteps(input, fact, context.name); review.push('LLM draft failed: template used, rewrite before sending'); }
  } else {
    steps = templateSteps(input, fact, context.name);
    review.push('template draft (no ANTHROPIC_API_KEY): rewrite the opening and the persona line');
  }

  const known = new Set(context.facts.map((f) => f.source_url).concat(fact.source_url));
  for (const c of claims) if (!known.has(c.source_url)) review.push(`claim with an unread source: "${c.claim}" (${c.source_url})`);
  if (fact.kind === 'none') review.push('no specific fact found on the account: research before sending');
  if (fact.date && !isFresh(fact.kind, fact.date)) review.push(`first-line fact is past its shelf life (${fact.date.slice(0, 10)})`);
  if (!input.person.email) review.push('no email for this person: LinkedIn steps only, or run the email cascade');
  else if (input.person.email_confidence && !['HIGH', 'MEDIUM'].includes(input.person.email_confidence)) review.push(`email confidence ${input.person.email_confidence}: not sendable as is`);
  const audit = auditSequence(steps);
  for (const f of audit.failed) review.push(`copy audit, step ${f.step}: ${f.check}${f.detail ? ` (${f.detail})` : ''}`);

  const out: Output = { domain, company: context.name, person: input.person, status: review.length ? 'needs_review' : 'draft', first_line_fact: fact, steps, audit: { score: audit.score, checks: audit.checks }, needs_review: review, by };
  if (input.out_dir) {
    fs.mkdirSync(input.out_dir, { recursive: true });
    out.path = path.join(input.out_dir, `${domain}--${input.person.first_name}-${input.person.last_name}.md`.toLowerCase().replace(/[^a-z0-9.@_-]+/g, '-'));
    fs.writeFileSync(out.path, renderSequence(out));
  }
  return out;
}

export const play = definePlay<Input, Output>({ name: NAME, description: DESCRIPTION, kind: 'scalar', input: Input, run: draftSequence });
