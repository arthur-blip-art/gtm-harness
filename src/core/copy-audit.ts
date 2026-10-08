/**
 * The copy audit, run by code, not by eye (rules 9 and 10 of recipes/account-to-sequence.md,
 * generalised). A draft that fails a check is not rejected: it is flagged for the human review.
 */
export interface Step { step: number; channel: 'email' | 'linkedin'; subject?: string | null; body: string }
export interface Check { step: number; check: string; ok: boolean; detail?: string }

const JARGON = /\b(leverage|seamless(ly)?|robust|game[- ]changer|innovative|holistic|best[- ]in[- ]class|empower|streamline|unlock|next[- ]level|synergy|cutting[- ]edge|revolutionary|disruptive)\b/i;
const MEETING = /(\b(a|quick|short|brief|\d+[- ]?min(ute)?s?)\s+(call|chat|meeting)\b|\b(hop on|jump on|book a|calendly|calendar link|schedule a|set up a (call|meeting)|meet next|rendez-vous|rdv|un appel|un échange de|un créneau|une visio|une démo|a demo)\b)/i;
const OPT_OUT = /(not the right person|won.t write again|pas la bonne personne|je ne vous écrirai plus|ne vous relancerai plus|unsubscribe|désinscri)/i;

export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function auditSequence(steps: Step[], opts: { maxWords?: { first: number; linkedin: number; other: number } } = {}): { checks: Check[]; score: number; failed: Check[] } {
  const lim = opts.maxWords ?? { first: 120, linkedin: 60, other: 150 };
  const checks: Check[] = [];
  const add = (step: number, check: string, ok: boolean, detail?: string) => checks.push({ step, check, ok, ...(detail ? { detail } : {}) });
  for (const s of steps) {
    const body = s.body ?? '';
    const firstSentence = body.split(/(?<=[.!?])\s/)[0] ?? '';
    const max = s.channel === 'linkedin' ? lim.linkedin : s.step === 1 ? lim.first : lim.other;
    add(s.step, 'length', words(body) <= max, `${words(body)}/${max} words`);
    add(s.step, 'no em or en dash', !/[—–]/.test(body + (s.subject ?? '')));
    add(s.step, 'no rhetorical question as hook', !/\?\s*$/.test(firstSentence.trim()));
    add(s.step, 'no jargon', !JARGON.test(body), JARGON.exec(body)?.[0]);
    const opening = body.split('\n').map((l) => l.trim()).find((l) => l && !/^(hi|hello|hey|bonjour|salut)\b[^.!?]*,?$/i.test(l)) ?? '';
    add(s.step, 'does not start with I', !/^(I|Je|J')(\s|'|’)/.test(opening));
    if (s.channel === 'email' && s.subject !== undefined) {
      const subj = (s.subject ?? '').trim();
      add(s.step, 'subject 6 words max, sentence case', !!subj && words(subj) <= 6 && subj !== subj.toUpperCase() && !/!/.test(subj), subj);
    }
    if (s.step === 1) {
      add(s.step, 'no meeting ask in step 1', !MEETING.test(body), MEETING.exec(body)?.[0]);
      if (s.channel === 'email') add(s.step, 'opt-out line', OPT_OUT.test(body));
    }
  }
  const failed = checks.filter((c) => !c.ok);
  return { checks, score: checks.length ? Math.round((100 * (checks.length - failed.length)) / checks.length) : 0, failed };
}
