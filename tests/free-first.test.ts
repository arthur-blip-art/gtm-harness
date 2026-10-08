import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { parsePage } from '../src/providers/web.ts';
import { parseRss } from '../src/providers/publicweb.ts';
import { headcountBands } from '../src/providers/registry-fr.ts';
import { atsBoard, keyPages, socialLinks } from '../src/core/discover.ts';
import { fingerprint } from '../src/core/tech-fingerprint.ts';
import { classifyHeadline, mentionsCompany, parseAmount, timingScore } from '../src/core/signal-rules.ts';
import { auditSequence } from '../src/core/copy-audit.ts';
import { parseLinkedinResult } from '../src/plays/company-to-people.ts';
import type { Output as ContextOutput } from '../src/plays/account-context.ts';
import type { Output as SignalsOutput } from '../src/plays/company-signals.ts';
import type { Output as IcpOutput } from '../src/plays/icp-to-companies.ts';
import type { Output as PeopleOutput } from '../src/plays/company-to-people.ts';
import type { Output as SequenceOutput } from '../src/plays/draft-sequence.ts';
import type { Output as ListeningOutput } from '../src/plays/social-listening.ts';
import type { Output as LinkedinOutput } from '../src/plays/linkedin-signals.ts';
import type { Output as ActionOutput } from '../src/plays/signal-to-action.ts';
import type { Output as ProspectOutput } from '../src/plays/prospect.ts';

const quiet = () => {};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-test-'));
const run = <O>(store: MemoryStore, play: string, input: unknown, extra: Record<string, unknown> = {}) => executePlay<O>({ store, resolvePlay, play: resolvePlay(play), input, dryRun: true, log: quiet, ...extra });
const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const OFFER = 'We give B2B teams the accounts and contacts that match their ICP, cheapest source first. Qonto cut list building time by 40%.';

describe('free layer helpers', () => {
  it('reads a page: text, links, scripts, markers, tel', () => {
    const p = parsePage('<html><head><title>Acme | Data</title><script src="https://js.hs-scripts.com/1.js"></script><script>analytics.load("x"); fbq("init")</script></head><body><a href="/pricing">Pricing</a><a href="https://jobs.lever.co/acme">Jobs</a><a href="tel:+33 1 23">Call</a><p>Hello &amp; welcome</p></body></html>', 'https://www.acme.io/');
    expect(p.title).toBe('Acme | Data');
    expect(p.links.map((l) => l.href)).toContain('https://www.acme.io/pricing');
    expect(p.scripts[0]).toContain('hs-scripts');
    expect(p.markers.join(' ')).toMatch(/analytics/);
    expect(p.phones).toEqual(['+33 1 23']);
    expect(p.text).toContain('Hello & welcome');
  });
  it('finds key pages, the ATS board and social profiles from links', () => {
    const links = [{ href: 'https://acme.io/pricing', text: 'Pricing' }, { href: 'https://acme.io/clients', text: 'Nos clients' }, { href: 'https://boards.greenhouse.io/acme', text: 'Careers' }, { href: 'https://www.linkedin.com/company/acme-hq/', text: '' }, { href: 'https://twitter.com/acmehq', text: '' }];
    expect(keyPages(links, 'https://acme.io/')).toMatchObject({ pricing: 'https://acme.io/pricing', customers: 'https://acme.io/clients', careers: 'https://boards.greenhouse.io/acme' });
    expect(atsBoard('https://jobs.ashbyhq.com/Acme.io')).toEqual({ ats: 'ashby', board: 'acme.io', tool: 'ashby_jobs' });
    expect(atsBoard('https://boards.greenhouse.io/embed/job_board?for=acme')).toMatchObject({ ats: 'greenhouse', board: 'acme' });
    expect(atsBoard('https://boards.greenhouse.io/embed/job_board/js?for=acme')).toMatchObject({ ats: 'greenhouse', board: 'acme' });
    expect(socialLinks(links)).toEqual({ linkedin: 'https://www.linkedin.com/company/acme-hq', x: 'acmehq' });
  });
  it('fingerprints the stack from DNS, website and job ads, with evidence', () => {
    const tech = fingerprint({
      dns: { mx: ['aspmx.l.google.com'], txt: ['v=spf1 include:_spf.salesforce.com include:sendgrid.net ~all'] },
      pages: [{ url: 'https://acme.io/', scripts: ['https://widget.intercom.io/w/1'], markers: ['_linkedin_partner_id'] }],
      jobs: [{ title: 'Data engineer', text: 'dbt and Snowflake', url: 'https://jobs/1' }],
    });
    const by = Object.fromEntries(tech.map((t) => [t.name, t.layer]));
    expect(by).toMatchObject({ Salesforce: 'dns', SendGrid: 'dns', 'Google Workspace': 'dns', Intercom: 'website', 'LinkedIn Insight Tag': 'website', Snowflake: 'jobs', dbt: 'jobs' });
  });
  it('classifies headlines and reads amounts, bilingual', () => {
    expect(classifyHeadline('Acme raises $25M Series B')).toBe('funding_round');
    expect(classifyHeadline('Acme lève 12 millions d\'euros')).toBe('funding_round');
    expect(classifyHeadline('Acme appoints Jane Roe as CTO')).toBe('leadership_change');
    expect(classifyHeadline('Acme acquires Beta')).toBe('acquisition');
    expect(classifyHeadline('Acme opens an office in London')).toBe('expansion');
    expect(classifyHeadline('Acme launches its AI assistant')).toBe('product_launch');
    expect(parseAmount('raises $25M Series B')).toEqual({ amount: 25e6, currency: 'USD' });
    expect(parseAmount('lève 12 millions d\'euros')).toEqual({ amount: 12e6, currency: 'EUR' });
    expect(mentionsCompany('Pilot raises $10M', 'Pilot')).toBe(true);
    expect(mentionsCompany('Autopilot raises $10M', 'Pilot')).toBe(false);
  });
  it('scores timing from fresh signals only', () => {
    const t = timingScore([{ type: 'funding_round', observedAt: ago(10) }, { type: 'funding_round', observedAt: ago(400) }, { type: 'job_opening', observedAt: ago(3) }, { type: 'job_opening', observedAt: ago(5) }]);
    expect(t.score).toBe(3.8);
    expect(t.reasons).toEqual(['funding_round', 'job_opening x2']);
  });
  it('parses RSS and maps headcount bands', () => {
    const items = parseRss('<rss><channel><item><title><![CDATA[Acme raises]]></title><link>https://n/1</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate><source url="x">Wire</source></item></channel></rss>');
    expect(items).toEqual([{ title: 'Acme raises', link: 'https://n/1', published_at: '2026-10-05T10:00:00.000Z', source: 'Wire' }]);
    expect(headcountBands(20, 200)).toEqual(['12', '21', '22', '31']);
  });
  it('parses a LinkedIn search result only when the company matches', () => {
    expect(parseLinkedinResult('Jane Doe - Head of Sales - Acme | LinkedIn', '', 'Acme')).toEqual({ first_name: 'Jane', last_name: 'Doe', title: 'Head of Sales' });
    expect(parseLinkedinResult('Jane Doe - Head of Sales - Other | LinkedIn', 'Other Inc', 'Acme')).toBeNull();
  });
  it('audits copy: meeting asks, dashes, opt-out; "reps can call" is not a meeting ask', () => {
    const good = auditSequence([{ step: 1, channel: 'email', subject: 'Your Series B', body: 'Hi Ana,\n\nYour Series B means reps can call new markets.\n\nNot the right person? Tell me and I won\'t write again.' }]);
    expect(good.failed).toEqual([]);
    const bad = auditSequence([{ step: 1, channel: 'email', subject: 'QUICK QUESTION!', body: 'Hi Ana,\n\nI wanted to reach out — can we book a 15 minute call to unlock growth?' }]);
    expect(bad.failed.map((c) => c.check).sort()).toEqual(['does not start with I', 'no em or en dash', 'no jargon', 'no meeting ask in step 1', 'no rhetorical question as hook', 'opt-out line', 'subject 6 words max, sentence case']);
  });
});

describe('free-first plays', () => {
  it('account-context: site, stack, jobs, news, phone, then an LLM brief with no invented source', async () => {
    const store = new MemoryStore();
    const dir = tmp();
    const r = await run<ContextOutput>(store, 'account-context', { domain: 'https://www.acme.io/', offer: OFFER, out_dir: dir });
    const o = r.output!;
    expect(o.name).toBe('Acme');
    expect(Object.keys(o.pages)).toEqual(expect.arrayContaining(['home', 'pricing', 'customers', 'integrations', 'careers', 'team']));
    expect(o.tech.map((t) => t.name)).toEqual(expect.arrayContaining(['HubSpot', 'Salesforce', 'SendGrid', 'Intercom', 'Stripe', 'Segment', 'Snowflake', 'dbt']));
    expect(o.jobs).toMatchObject({ ats: 'greenhouse', count: 2 });
    expect(o.news.map((n) => n.type)).toEqual(['funding_round', 'leadership_change']); // the unrelated headline is filtered
    expect(o.phone?.number).toBe('+33 1 84 80 00 00');
    expect(o.summary.by).toBe('llm');
    expect(o.summary.angles.map((a) => a.source_url)).not.toContain('https://invented.example/');
    expect(o.email).toEqual({ suite: 'Google Workspace', dmarc: 'quarantine' });
    expect(fs.readFileSync(path.join(dir, 'acme.io.md'), 'utf8')).toMatch(/## Stack \(free detection\)/);
    expect((await store.listSignals(['acme.io'])).map((s) => s.type).sort()).toEqual(['funding_round', 'job_opening', 'job_opening', 'leadership_change']);
    expect(r.receipt.legs.filter((l) => l.provider === 'web' || l.provider === 'ats' || l.provider === 'publicweb').every((l) => l.credits === 0)).toBe(true);
  });
  it('company-signals: free sources cover funding and jobs, so paid legs do not run (gap)', async () => {
    const store = new MemoryStore();
    const r = await run<SignalsOutput>(store, 'company-signals', { domain: 'acme.io' });
    expect(r.output!.covered).toMatchObject({ funding: true, jobs: true, leadership: true });
    expect(r.output!.sources).toMatchObject({ predictleads_funding: 'covered_free', predictleads_jobs: 'covered_free', theirstack_jobs: 'covered_free', crustdata_headcount: 'hit' });
    const never = await run<SignalsOutput>(new MemoryStore(), 'company-signals', { domain: 'quietco.io', paid: 'never' });
    expect(never.receipt.totalCredits).toBe(0);
  });
  it('company-signals: BODACC for a French registry company, paid fills the gaps when free finds nothing', async () => {
    const store = new MemoryStore();
    await store.upsertCompany({ domain: 'quietco.fr', name: 'Quietco', country: 'FR', fieldSources: {}, raw: { registry_fr: { siren: '812345678' } } });
    const r = await run<SignalsOutput>(store, 'company-signals', { domain: 'quietco.fr' });
    expect(r.output!.sources.bodacc).toBe('hit');
    expect(r.output!.signals.find((s) => s.source === 'bodacc')?.type).toBe('funding_round');
    expect(r.output!.sources.predictleads_funding).toBe('covered_free'); // BODACC capital change counts
  });
  it('icp-to-companies: lookalikes and the FR registry before any paid database', async () => {
    const store = new MemoryStore();
    const r = await run<IcpOutput>(store, 'icp-to-companies', { countries: ['FR'], headcount_min: 20, headcount_max: 200, seed_domains: ['lemlist.com'], limit: 4 });
    const o = r.output!;
    expect(o.companies.map((c) => c.source)).toEqual(['exa_similar', 'exa_similar', 'registry_fr', 'registry_fr']);
    expect(o.companies.map((c) => c.domain)).not.toContain('g2.com');
    expect(o.companies.find((c) => c.source === 'registry_fr')!.domain).toBe('logicielalpha.fr'); // the directory result is skipped
    expect(r.receipt.legs.some((l) => l.provider === 'apollo' && l.calls > 0)).toBe(false);
    expect((store.companies.get('logicielalpha.fr')!.raw as any).registry_fr.officers[0].last_name).toBe('MARTIN');
  });
  it('company-to-people: legal officers and LinkedIn dorks before paid people search', async () => {
    const store = new MemoryStore();
    await run(store, 'icp-to-companies', { countries: ['FR'], limit: 2 });
    const r = await run<PeopleOutput>(store, 'company-to-people', { domain: 'logicielalpha.fr', titles: ['CEO', 'VP Sales'], limit: 2 });
    expect(r.output!.people.map((p) => [p.source, p.first_name, p.last_name, p.title])).toEqual([
      ['registry_officers', 'Marie', 'Martin', 'CEO (Président)'],
      ['serper_linkedin', 'Sophie', 'Laurentceo-logiciel', 'CEO'],
    ]);
    expect(r.receipt.legs.find((l) => l.leg === 'fullenrich')?.label).toBe('NEVER REACHED');
  });
  it('draft-sequence: LLM draft passes the audit; without the LLM a template is flagged for rewrite', async () => {
    const store = new MemoryStore();
    const ctxOut = (await run<ContextOutput>(store, 'account-context', { domain: 'acme.io' })).output!;
    const person = { first_name: 'Ana', last_name: 'Silva', title: 'VP Sales', email: 'ana@acme.io', email_confidence: 'HIGH' };
    const llm = (await run<SequenceOutput>(store, 'draft-sequence', { domain: 'acme.io', person, offer: OFFER, context: ctxOut })).output!;
    expect(llm.by).toBe('llm');
    expect(llm.first_line_fact.kind).toBe('funding_round');
    expect(llm.audit.score).toBe(100);
    expect(llm.status).toBe('draft');
    const tpl = (await run<SequenceOutput>(store, 'draft-sequence', { domain: 'acme.io', person, offer: OFFER, context: ctxOut }, { legs: ['none'] })).output!;
    expect(tpl.by).toBe('template');
    expect(tpl.needs_review[0]).toMatch(/template draft/);
  });
  it('social-listening: every source, intent flagged, only new mentions count on rerun', async () => {
    const store = new MemoryStore();
    const r1 = await run<ListeningOutput>(store, 'social-listening', { terms: ['Clay'], x_handles: ['clayhq'] });
    expect(Object.keys(r1.output!.by_source).sort()).toEqual(['hacker_news', 'linkedin', 'news', 'reddit', 'web', 'x']);
    expect(r1.output!.intent).toBeGreaterThanOrEqual(2); // "alternative to" on HN and Reddit
    const r2 = await run<ListeningOutput>(store, 'social-listening', { terms: ['Clay'], x_handles: ['clayhq'] });
    expect(r2.output!.new_mentions).toBe(0);
  });
  it('linkedin-signals: a champion seen at another company becomes a job_change', async () => {
    const store = new MemoryStore();
    await store.upsertSignals([{ dedupeKey: 'old', domain: 'person:sam-lee', type: 'champion_position', source: 'harvestapi', observedAt: ago(200), value: { company: 'OldCo' } }]);
    const r = await run<LinkedinOutput>(store, 'linkedin-signals', { champions: ['https://www.linkedin.com/in/sam-lee'], notify: false });
    const jc = r.output!.signals.find((s) => s.type === 'job_change')!;
    expect(jc.value).toMatchObject({ from_company: 'OldCo', to_company: 'TrackedCo' });
  });
  it('signal-to-action: a fresh signal triggers people, emails, context and drafts, once', async () => {
    const store = new MemoryStore();
    await store.upsertCompany({ domain: 'acme.io', name: 'Acme', fieldSources: {}, raw: {} });
    await run(store, 'company-signals', { domain: 'acme.io', paid: 'never' });
    const dir = tmp();
    const r1 = await run<ActionOutput>(store, 'signal-to-action', { titles: ['VP Sales'], offer: OFFER, out_dir: dir, people_per_account: 1 });
    expect(r1.output!.actioned).toBe(1);
    expect(r1.output!.actions[0]).toMatchObject({ domain: 'acme.io', status: 'drafted', signal: { type: 'funding_round' } });
    const draft = fs.readFileSync(r1.output!.actions[0].drafts[0], 'utf8');
    expect(draft).toMatch(/First line fact.*Series B/);
    const r2 = await run<ActionOutput>(store, 'signal-to-action', { titles: ['VP Sales'], offer: OFFER, out_dir: dir });
    expect(r2.output!.actioned).toBe(0);
  });
  it('prospect: the button writes accounts, people, briefs and drafts; emails stay with their account', async () => {
    const store = new MemoryStore();
    const dir = tmp();
    const r = await run<ProspectOutput>(store, 'prospect', { countries: ['FR'], headcount_min: 20, headcount_max: 200, seed_domains: ['lemlist.com'], titles: ['VP Sales', 'CEO'], offer: OFFER, accounts: 3, out_dir: dir });
    const o = r.output!;
    expect(o.worked).toBe(3);
    expect(o.drafts).toBe(3);
    for (const f of ['README.md', 'accounts.csv', 'people.csv']) expect(fs.existsSync(path.join(dir, f))).toBe(true);
    const people = fs.readFileSync(path.join(dir, 'people.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
    for (const p of people) if (p[7]) expect(p[7].endsWith(`@${p[4]}`)).toBe(true);
    expect(o.accounts.every((a) => a.timing > 0)).toBe(true);
    const legs = r.receipt.legs.map((l) => `${l.leg}|${l.provider}|${l.tool}`);
    expect(new Set(legs).size).toBe(legs.length); // one receipt line per leg, summed across accounts
  });
});
