import type { Output as Context } from '../plays/account-context.ts';
import type { Output as Sequence } from '../plays/draft-sequence.ts';

const d = (s?: string | null) => (s ? s.slice(0, 10) : 'undated');

/** One page a seller reads in two minutes before a call: what, who, why now, angles, sources. */
export function renderBrief(c: Context): string {
  const L: string[] = [];
  L.push(`# ${c.name} (${c.domain})`, '');
  L.push(`**What they sell.** ${c.summary.one_liner}`, `**Who buys it.** ${c.summary.sells_to}`, `**Model.** ${c.summary.business_model}`, `**Why now.** ${c.summary.why_now}`, '');
  if (c.summary.angles.length) {
    L.push('## Angles', '');
    for (const a of c.summary.angles) L.push(`- **${a.angle}**: ${a.fact} ([source](${a.source_url}))`);
    L.push('');
  }
  const dated = c.signals.filter((s) => s.type !== 'job_opening').sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? ''));
  if (dated.length) {
    L.push('## Dated events', '');
    for (const s of dated.slice(0, 8)) L.push(`- ${d(s.observedAt)} · ${s.type} · ${(s.value as any).title ?? ''} ([source](${(s.value as any).url}))`);
    L.push('');
  }
  if (c.jobs.count) L.push('## Hiring', '', `${c.jobs.count} open roles on ${c.jobs.ats}: ${c.jobs.titles.slice(0, 10).join('; ')}`, '');
  if (c.tech.length) {
    L.push('## Stack (free detection)', '', '| tool | category | seen in | evidence |', '|---|---|---|---|');
    for (const t of c.tech) L.push(`| ${t.name} | ${t.category} | ${t.layer} | ${t.evidence.replace(/\|/g, '/')} |`);
    L.push('');
  }
  L.push('## Reach', '');
  if (c.phone) L.push(`- Switchboard: ${c.phone.number} (${c.phone.source})`);
  if (c.social.linkedin) L.push(`- LinkedIn: ${c.social.linkedin}`);
  if (c.email.suite) L.push(`- Mail suite: ${c.email.suite}${c.email.dmarc ? `, DMARC p=${c.email.dmarc}` : ''}`);
  L.push('');
  if (c.summary.unknowns.length) L.push('## Check before writing', '', ...c.summary.unknowns.map((u) => `- ${u}`), '');
  L.push(`_Pages read: ${Object.entries(c.pages).map(([k, u]) => `[${k}](${u})`).join(', ') || 'none (site unreachable)'}. Summary by ${c.summary.by}._`, '');
  return L.join('\n');
}

export function renderSequence(s: Sequence): string {
  const L: string[] = [];
  L.push(`# ${s.person.first_name} ${s.person.last_name}, ${s.person.title ?? ''} at ${s.company} (${s.domain})`, '');
  L.push(`Status: **${s.status}**${s.needs_review.length ? ` · review: ${s.needs_review.length} item(s)` : ''}`, '');
  L.push(`**First line fact.** ${s.first_line_fact.fact} ([source](${s.first_line_fact.source_url}), ${d(s.first_line_fact.date)})`, '');
  for (const st of s.steps) {
    L.push(`## Step ${st.step} · ${st.channel}${st.subject ? ` · "${st.subject}"` : ''}`, '', st.body, '');
  }
  L.push('## Audit', '', `Score ${s.audit.score}/100`, '', '| step | check | ok | detail |', '|---|---|---|---|');
  for (const c of s.audit.checks) L.push(`| ${c.step} | ${c.check} | ${c.ok ? 'yes' : '**no**'} | ${c.detail ?? ''} |`);
  if (s.needs_review.length) L.push('', '## Before sending, check', '', ...s.needs_review.map((r) => `- ${r}`));
  L.push('');
  return L.join('\n');
}
