import { defineAdapter } from './_adapter.ts';
import { nameToken } from '../core/normalize.ts';
import type { PriceEntry, ToolDef, ToolInput, ToolResult } from '../core/types.ts';

/**
 * Deterministic fake provider for --dry-run and tests. Behaviour is a function of the input only.
 * Tool keys may be `provider.tool` (provider-specific) or `tool` (shared); the ToolRunner tries the
 * specific key first in dry-run.
 *
 * Email buckets by the last name's first letter:
 *   a–d pattern · e–f hunter · g–h leadmagic · i–j findymail · k–l prospeo · m–n apollo
 *   o fullenrich DELIVERABLE · p fullenrich CATCH_ALL · q–v pdl (unknown → verifier ok) · w–z nobody
 * Phone buckets: a–m lusha (mobile) · n–t kaspr · u–z fullenrich phones.
 * LinkedIn: serper returns the right person unless the last name starts with x (wrong person).
 */
const letter = (i: ToolInput) => nameToken(i.last_name ?? i.lastname ?? i.name ?? '')[0] ?? 'x';
const inRange = (c: string, a: string, b: string) => c >= a && c <= b;
const email = (i: ToolInput) => `${nameToken(i.first_name)}.${nameToken(i.last_name)}@${String(i.domain)}`;
const miss = (reason = 'no_match'): ToolResult => ({ status: 'miss', missReason: reason, output: {} });
const norm = (i: ToolInput) => ({
  first_name: nameToken(i.first_name), last_name: nameToken(i.last_name), domain: String(i.domain ?? ''),
  ...(i.linkedin_url ? { linkedin_url: String(i.linkedin_url) } : {}), ...(i.enrich_fields ? { enrich_fields: i.enrich_fields } : {}),
});
const emailLeg = (a: string, b: string, rawStatus: string) => async (i: ToolInput): Promise<ToolResult> =>
  inRange(letter(i), a, b) ? { status: 'hit', output: { email: email(i), email_status: rawStatus } } : miss();

const table: Record<string, PriceEntry> = {};
const tools: Record<string, ToolDef> = {};
function tool(name: string, basis: PriceEntry['basis'], credits: number, execute: (i: ToolInput) => Promise<ToolResult>, extra: Partial<ToolDef> = {}) {
  table[name] = { basis, credits };
  tools[name] = {
    description: `mock ${name}`, normalize: norm, execute,
    cost: (r) => (typeof r.costOverride === 'number' ? r.costOverride : r.status === 'error' ? 0 : basis === 'per_hit' || basis === 'per_result' ? (r.status === 'hit' ? credits : 0) : basis === 'free' ? 0 : credits),
    ...extra,
  };
}

// ---- email legs
tool('millionverifier.verify_patterns', 'per_call', 0.01, async (i) => (inRange(letter(i), 'a', 'd') ? { status: 'hit', output: { email: email(i), result: 'ok' }, costOverride: 0.01 } : { ...miss('no_pattern_valid'), costOverride: 0.03 }));
tool('hunter.email_finder', 'per_hit', 1, emailLeg('e', 'f', 'valid'));
tool('leadmagic.email_finder', 'per_hit', 1, emailLeg('g', 'h', 'valid'));
tool('findymail.find_from_name', 'per_hit', 1, emailLeg('i', 'j', 'verified'));
tool('prospeo.enrich_person', 'per_hit', 1, async (i) => (inRange(letter(i), 'k', 'l') ? { status: 'hit', output: { email: email(i), email_status: 'verified' } } : miss()));
tool('apollo.people_match', 'per_hit', 1, emailLeg('m', 'n', 'verified'));
tool('fullenrich.bulk_enrich', 'per_hit', 1, async () => miss(), {
  maxBatch: 50,
  async executeBatch(inputs) {
    return inputs.map((i): ToolResult => {
      const fields = (i.enrich_fields as string[] | undefined) ?? ['contact.emails'];
      if (fields.includes('contact.phones')) return inRange(letter(i), 'u', 'z') ? { status: 'hit', output: { phone: `+3367000${letter(i).charCodeAt(0)}`, phone_type: 'mobile' } } : miss();
      const c = letter(i);
      if (c === 'o') return { status: 'hit', output: { email: email(i), email_status: 'DELIVERABLE' } };
      if (c === 'p') return { status: 'hit', output: { email: email(i), email_status: 'CATCH_ALL' } };
      return miss();
    });
  },
});
tool('crustdata.person_enrich', 'per_result', 1, async (i) => (i.linkedin_url && inRange(letter(i), 'q', 'r') ? { status: 'hit', output: { email: `${String(i.linkedin_url).split('/in/')[1]?.replace('-', '.')}@example.com`, email_status: 'verified' } } : miss()), { normalize: (i) => ({ linkedin_url: String(i.linkedin_url ?? '') }) });
tool('peopledatalabs.person_enrich', 'per_hit', 3, async (i) => (inRange(letter(i), 'q', 'v') ? { status: 'hit', output: { email: email(i), email_status: 'unknown' }, costOverride: 3 } : { ...miss(), costOverride: 0 }));

// ---- verifiers
const verifyEmail = (i: ToolInput) => {
  const local = String(i.email ?? '').split('@')[0];
  const last = local.split('.')[1] ?? local;
  return last[0] ?? 'x';
};
tool('millionverifier.verify', 'per_call', 0.01, async (i) => {
  const c = verifyEmail(i);
  const result = c === 'p' ? 'catch_all' : inRange(c, 'q', 'v') ? 'ok' : 'invalid';
  return result === 'ok' ? { status: 'hit', output: { email: i.email, result } } : { status: 'miss', missReason: result, output: { email: i.email, result } };
}, { normalize: (i) => ({ email: String(i.email ?? '') }) });
tool('zerobounce.validate', 'per_call', 0.01, async (i) => {
  const c = verifyEmail(i);
  const status = c === 'p' ? 'catch-all' : inRange(c, 'q', 'v') ? 'valid' : 'invalid';
  return status === 'invalid' ? { status: 'miss', missReason: status, output: { email: i.email, status, email_status: 'invalid' } } : { status: 'hit', output: { email: i.email, status, email_status: status.replace('-', '_') } };
}, { normalize: (i) => ({ email: String(i.email ?? '') }) });
tool('hunter.email_verifier', 'per_call', 1, async (i) => ({ status: 'hit', output: { email: i.email, email_status: 'valid' } }), { normalize: (i) => ({ email: String(i.email ?? '') }) });
tool('leadmagic.email_validation', 'per_call', 0.05, async (i) => ({ status: 'hit', output: { email: i.email, email_status: 'valid' } }), { normalize: (i) => ({ email: String(i.email ?? '') }) });
tool('findymail.verify', 'per_call', 0.05, async (i) => ({ status: 'hit', output: { email: i.email, email_status: 'valid' } }), { normalize: (i) => ({ email: String(i.email ?? '') }) });
tool('hunter.email_count', 'free', 0, async (i) => ({ status: 'hit', output: { domain: i.domain, total: 42, pattern: '{first}.{last}' } }), { normalize: (i) => ({ domain: String(i.domain ?? '') }) });

// ---- linkedin → email
tool('findymail.find_from_linkedin', 'per_hit', 1, async (i) => (String(i.linkedin_url).includes('-') ? { status: 'hit', output: { email: `${String(i.linkedin_url).split('/in/')[1]?.replace('-', '.')}@${i.domain ?? 'example.com'}`, email_status: 'verified' } } : miss()), { normalize: (i) => ({ linkedin_url: String(i.linkedin_url ?? ''), domain: String(i.domain ?? '') }) });
tool('kaspr.linkedin_profile', 'per_hit', 1, async (i) => {
  const slug = String(i.linkedin_url ?? '').split('/in/')[1] ?? '';
  const want = (i.dataToGet as string[] | undefined) ?? ['workEmail'];
  const c = slug.split('-')[1]?.[0] ?? 'x';
  if (want.includes('phone')) return inRange(c, 'n', 't') ? { status: 'hit', output: { phone: `+3366100${c.charCodeAt(0)}`, phone_type: 'mobile' }, costOverride: 1 } : miss();
  return inRange(c, 'a', 'm') ? { status: 'hit', output: { email: `${slug.replace('-', '.')}@${i.domain ?? 'example.com'}`, email_status: 'valid' }, costOverride: 0.05 } : miss();
}, { normalize: (i) => ({ linkedin_url: String(i.linkedin_url ?? ''), dataToGet: i.dataToGet ?? ['workEmail'], domain: String(i.domain ?? '') }) });

// ---- phone
tool('lusha.enrich_person', 'per_hit', 1, async (i) => {
  const c = letter(i);
  const reveal = String(i.reveal ?? 'both');
  const phone = inRange(c, 'a', 'm') ? { phone: `+3360000${c.charCodeAt(0)}`, phone_type: 'mobile' } : {};
  const em = reveal !== 'phone' && inRange(c, 'a', 'c') ? { email: email(i), email_status: 'high' } : {};
  const out = { ...phone, ...em };
  return Object.keys(out).length ? { status: 'hit', output: out } : miss();
}, { normalize: (i) => ({ ...norm(i), reveal: String(i.reveal ?? 'both') }) });
tool('leadmagic.mobile_finder', 'per_hit', 2, async () => miss());

// ---- search
tool('serper.google_search', 'per_call', 0.01, async (i) => {
  const q = String(i.q ?? i.query ?? '');
  if (/site:linkedin\.com\/in/.test(q)) {
    const m = /"([^"]+)"/.exec(q);
    const [first = 'jane', ...rest] = (m?.[1] ?? 'Jane Doe').split(/\s+/);
    const last = rest.join(' ') || 'doe';
    const company = q.replace(/"[^"]+"/, '').replace(/site:\S+/, '').trim() || 'Acme';
    const wrong = nameToken(last)[0] === 'x';
    const title = wrong ? `Julie Ho - CFO - Other Corp | LinkedIn` : `${first} ${last} - Head of Product - ${company} | LinkedIn`;
    const slug = wrong ? 'julie-ho' : `${nameToken(first)}-${nameToken(last)}`;
    return { status: 'hit', output: { results: [{ title, link: `https://www.linkedin.com/in/${slug}/`, snippet: `${company} · Paris`, position: 1 }] } };
  }
  const word = q.replace(/official website/i, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return { status: 'hit', output: { results: [{ title: word, link: `https://www.${word || 'example'}.com/`, snippet: '' }] } };
}, { normalize: (i) => ({ q: String(i.q ?? i.query ?? ''), num: Number(i.num ?? 10) }) });
tool('exa.search', 'per_call', 0.05, async (i) => {
  const word = String(i.query).replace(/official website/i, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return { status: 'hit', output: { results: [{ url: `https://www.${word || 'example'}.com/`, title: word }] } };
}, { normalize: (i) => ({ query: String(i.query ?? '') }) });

// ---- companies
const fakeCompanies = (n: number, prefix: string) => Array.from({ length: n }, (_, k) => ({ name: `${prefix} ${k + 1}`, domain: `${prefix.toLowerCase()}${k + 1}.com`, employee_count: 50 + k * 10, country: 'FR', industry: 'software' }));
tool('apollo.mixed_companies_search', 'per_call', 0, async (i) => ({ status: 'hit', output: { companies: fakeCompanies(Math.min(Number(i.per_page ?? 25), 3), 'Apollo'), total: 42 } }), { normalize: (i) => ({ ...i }) });
tool('theirstack.company_search', 'per_result', 1, async (i) => ({ status: 'hit', output: { companies: fakeCompanies(Math.min(Number(i.limit ?? 25), 2), 'Stack'), total: 17 }, costOverride: Math.min(Number(i.limit ?? 25), 2) }), { normalize: (i) => ({ ...i }) });
tool('crustdata.company_search', 'per_result', 0.02, async (i) => ({ status: 'hit', output: { companies: fakeCompanies(Math.min(Number(i.limit ?? 25), 2), 'Crust'), total: 9 }, costOverride: 0.04 }), { normalize: (i) => ({ ...i }) });
tool('apollo.organizations_enrich', 'per_call', 0, async (i) => ({ status: 'hit', output: { name: String(i.domain).split('.')[0], domain: i.domain, linkedin_url: `https://www.linkedin.com/company/${String(i.domain).split('.')[0]}`, country: 'France', city: 'Paris', industry: 'software', headcount: 120, founded_year: 2019, funding_total_usd: 15_000_000, funding_last_round: 'Series A', funding_last_date: '2025-06-01', tech: ['Salesforce', 'Segment'] } }), { normalize: (i) => ({ domain: String(i.domain ?? '') }) });
tool('peopledatalabs.company_enrich', 'per_hit', 1, async (i) => ({ status: 'hit', output: { name: String(i.domain).split('.')[0], headcount: 118, industry: 'computer software', country: 'france', founded_year: 2019 } }), { normalize: (i) => ({ domain: String(i.domain ?? '') }) });
tool('crustdata.company_enrich', 'per_result', 1, async (i) => ({ status: 'hit', output: { name: String(i.domain).split('.')[0], headcount: 121, headcount_growth_6m_pct: 12.5, funding_total_usd: 15_000_000 } }), { normalize: (i) => ({ domain: String(i.domain ?? '') }) });
tool('apollo.mixed_people_search', 'per_call', 0, async (i) => {
  const domain = String((i.domains as string[] | undefined)?.[0] ?? i.domain ?? 'example.com');
  const titles = (i.titles as string[] | undefined) ?? ['CTO'];
  return { status: 'hit', output: { people: titles.slice(0, 2).map((t, k) => ({ first_name: ['Alice', 'Marc'][k], last_name: ['Durand', 'Petit'][k], title: t, linkedin_url: `https://www.linkedin.com/in/${['alice-durand', 'marc-petit'][k]}`, domain })), total: 5 } };
}, { normalize: (i) => ({ ...i }) });
tool('prospeo.search_person', 'per_call', 1, async () => ({ status: 'hit', output: { people: [], total: 0 } }), { normalize: (i) => ({ ...i }) });
tool('prospeo.search_company', 'per_call', 1, async () => ({ status: 'hit', output: { companies: [], total: 0 } }), { normalize: (i) => ({ ...i }) });

// ---- signals
tool('predictleads.financing_events', 'per_call', 1, async (i) => ({ status: 'hit', output: { events: [{ amount: 15_000_000, currency: 'USD', date: '2026-08-15', financing_type: 'Series A', url: `https://news.example.com/${i.domain}` }] } }), { normalize: (i) => ({ domain: String(i.domain ?? '') }) });
tool('predictleads.job_openings', 'per_call', 1, async (i) => ({ status: 'hit', output: { jobs: [{ title: 'Integration Engineer', first_seen_at: '2026-09-01', url: `https://jobs.example.com/${i.domain}/1` }, { title: 'Head of Partnerships', first_seen_at: '2026-09-10', url: `https://jobs.example.com/${i.domain}/2` }] } }), { normalize: (i) => ({ domain: String(i.domain ?? '') }) });
tool('theirstack.job_search', 'per_result', 0.5, async (i) => ({ status: 'hit', output: { jobs: [{ job_title: 'Product Manager Integrations', date_posted: '2026-09-05', url: 'https://jobs.example.com/ts/1', domain: (i.company_domain_or as string[])?.[0] }], total: 1 }, costOverride: 0.5 }), { normalize: (i) => ({ ...i }) });

// ---- hubspot (never cached)
const hsId = (s: string) => `hs_${[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)}`;
tool('hubspot.search_objects', 'free', 0, async (i) => {
  const v = String((i.filters as any)?.[0]?.value ?? '');
  return v.includes('known') ? { status: 'hit', output: { results: [{ id: hsId(v), properties: { email: v, domain: v } }] } } : miss('not_found');
}, { normalize: (i) => ({ ...i }), noCache: true });
tool('hubspot.batch_upsert', 'free', 0, async (i) => ({ status: 'hit', output: { results: ((i.inputs as any[]) ?? []).map((x) => ({ id: hsId(String(x.id)), properties: x.properties })) } }), { normalize: (i) => ({ ...i }), noCache: true });
tool('hubspot.create', 'free', 0, async (i) => ({ status: 'hit', output: { id: hsId(JSON.stringify(i.properties)), properties: i.properties } }), { normalize: (i) => ({ ...i }), noCache: true });
tool('hubspot.update', 'free', 0, async (i) => ({ status: 'hit', output: { id: i.id, properties: i.properties } }), { normalize: (i) => ({ ...i }), noCache: true });
tool('hubspot.associate', 'free', 0, async () => ({ status: 'hit', output: { ok: true } }), { normalize: (i) => ({ ...i }), noCache: true });

// ---- harvestapi (LinkedIn) — deterministic posts/engagers
const post = (url: string, author: string, title: string, company: string, text: string) => ({ post_url: url, text, posted_at: '2026-09-24T08:00:00Z', author_name: author, author_title: title, author_linkedin: `https://www.linkedin.com/in/${nameToken(author.split(' ')[0])}-${nameToken(author.split(' ')[1] ?? 'x')}`, author_company: company, reactions: 12, comments: 3 });
tool('harvestapi.search_posts', 'per_result', 0.02, async (i) => {
  const kw = String(i.search);
  return { status: 'hit', output: { posts: [
    post(`https://www.linkedin.com/posts/lea-martin_${nameToken(kw)}-1`, 'Léa Martin', 'CTO @ Fintou', 'Fintou', `On a passé 3 mois sur notre ${kw} avec Sage et Pennylane, et ce n'est pas fini…`),
    post(`https://www.linkedin.com/posts/marc-dubois_${nameToken(kw)}-2`, 'Marc Dubois', 'Account Executive @ Someco', 'Someco', `Webinar demain sur ${kw}`),
  ], count: 2 }, costOverride: 0.04 };
}, { normalize: (i) => ({ search: String(i.search ?? ''), postedLimit: String(i.postedLimit ?? 'week') }) });
tool('harvestapi.company_posts', 'per_result', 0.02, async (i) => ({ status: 'hit', output: { posts: [post(`https://www.linkedin.com/posts/${String(i.company).split('/company/')[1] ?? 'comp'}_launch-1`, String(i.company).split('/company/')[1] ?? 'Comp', 'Company', String(i.company), 'We just launched our new accounting API for fintechs')], count: 1 }, costOverride: 0.02 }), { normalize: (i) => ({ company: String(i.company ?? ''), postedLimit: String(i.postedLimit ?? 'week') }) });
tool('harvestapi.profile_posts', 'per_result', 0.02, async (i) => {
  const slug = String(i.profile).split('/in/')[1] ?? 'x';
  return slug.startsWith('a') || slug.startsWith('s') ? { status: 'hit', output: { posts: [post(`https://www.linkedin.com/posts/${slug}_erp-1`, slug.replace('-', ' '), 'CTO', 'TrackedCo', 'Rebuilding our ERP connectors this quarter. Lessons learned…')], count: 1 }, costOverride: 0.02 } : { status: 'miss', missReason: 'no_posts', output: { posts: [], count: 0 }, costOverride: 0 };
}, { normalize: (i) => ({ profile: String(i.profile ?? ''), postedLimit: String(i.postedLimit ?? 'week') }) });
tool('harvestapi.post_reactions', 'per_result', 0.02, async (i) => ({ status: 'hit', output: { people: [
  { name: 'Sara Cohen', title: 'CTO at Payflow', linkedin_url: 'https://www.linkedin.com/in/sara-cohen', reaction: 'LIKE' },
  { name: 'Tom Leroy', title: 'Sales Manager at Retailco', linkedin_url: 'https://www.linkedin.com/in/tom-leroy', reaction: 'LIKE' },
], count: 2 }, costOverride: 0.04 }), { normalize: (i) => ({ post: String(i.post ?? '') }) });
tool('harvestapi.post_comments', 'per_result', 0.02, async (i) => ({ status: 'hit', output: { people: [
  { name: 'Nina Rossi', title: 'Head of Partnerships at Billwise', linkedin_url: 'https://www.linkedin.com/in/nina-rossi', reaction: 'comment', text: 'Does it cover Exact and Odoo?' },
], count: 1 }, costOverride: 0.02 }), { normalize: (i) => ({ post: String(i.post ?? '') }) });
tool('harvestapi.get_profile', 'per_hit', 0.04, async (i) => ({ status: 'hit', output: { linkedin_url: i.url, headline: 'CTO', title: 'CTO', company: 'TrackedCo' } }), { normalize: (i) => ({ url: String(i.url ?? '') }) });

// ---- shared fallbacks by bare tool name (used by unit tests)
tools.people_match = tools['apollo.people_match']; table.people_match = table['apollo.people_match'];
tools.bulk_enrich = tools['fullenrich.bulk_enrich']; table.bulk_enrich = table['fullenrich.bulk_enrich'];
tools.verify = tools['millionverifier.verify']; table.verify = table['millionverifier.verify'];
tools.search = tools['exa.search']; table.search = table['exa.search'];

export const mock = defineAdapter({
  name: 'mock',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-24', table },
  requiredEnv: [],
  tools,
});
