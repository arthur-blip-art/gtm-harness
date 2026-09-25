import { costFromTable, defineAdapter, errorResult, httpJson, pick } from './_adapter.ts';
import { env } from '../config.ts';
import { normalizeLinkedin, norm } from '../core/normalize.ts';

/**
 * HarvestAPI: LinkedIn data without cookies (profiles, company and profile posts, keyword post search,
 * reactions and comments). Used for LinkedIn buying signals. Pull only: nothing
 * calls us back; the linkedin-signals play polls on a schedule and diffs against the signals table.
 * Public Apify pricing 2026-09: ~$2 per 1k posts/reactions/comments, ~$4 per 1k full profiles.
 * Direct API (api.harvestapi.io) is a subscription with a concurrency cap; both need `verify against docs`.
 */
const BASE = 'https://api.harvestapi.io/linkedin'; // verify against docs
const PRICE = {
  search_posts: { basis: 'per_result', credits: 0.02, note: '~$0.002 per post' },
  company_posts: { basis: 'per_result', credits: 0.02, note: '~$0.002 per post' },
  profile_posts: { basis: 'per_result', credits: 0.02, note: '~$0.002 per post' },
  post_reactions: { basis: 'per_result', credits: 0.02, note: '~$0.002 per reaction (billed like posts)' },
  post_comments: { basis: 'per_result', credits: 0.02, note: '~$0.002 per comment' },
  get_profile: { basis: 'per_hit', credits: 0.04, note: '~$0.004 per full profile' },
} as const;

const headers = () => ({ 'X-API-Key': env('HARVESTAPI_API_KEY') ?? '', accept: 'application/json' }); // verify against docs

async function page(ctx: Parameters<NonNullable<import('../core/types.ts').ToolDef['execute']>>[1], path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params);
  const { status, body } = await httpJson(ctx, `${BASE}/${path}?${qs}`, { headers: headers() }); // verify against docs
  if (status !== 200) return { error: errorResult(status, body, body?.message ?? body?.error) };
  const elements: any[] = body?.elements ?? body?.data ?? [];
  return { elements, pagination: body?.pagination ?? null };
}

const postOut = (p: any) => ({
  post_url: p.linkedinUrl ?? p.url ?? p.postUrl ?? null,
  text: String(p.content ?? p.text ?? '').slice(0, 1200),
  posted_at: p.postedAt?.date ?? p.postedAt ?? p.date ?? null,
  author_name: p.author?.name ?? p.author?.fullName ?? null,
  author_title: p.author?.headline ?? p.author?.position ?? null,
  author_linkedin: p.author?.linkedinUrl ?? p.author?.url ?? null,
  author_company: p.author?.company?.name ?? p.company?.name ?? null,
  reactions: p.engagement?.likes ?? p.socialContent?.numLikes ?? null,
  comments: p.engagement?.comments ?? p.socialContent?.numComments ?? null,
});
const personOut = (r: any) => ({
  name: r.actor?.name ?? r.author?.name ?? r.name ?? null,
  title: r.actor?.headline ?? r.author?.headline ?? r.headline ?? null,
  linkedin_url: normalizeLinkedin(r.actor?.linkedinUrl ?? r.author?.linkedinUrl ?? r.linkedinUrl ?? r.url) ?? null,
  reaction: r.reactionType ?? r.type ?? (r.commentary || r.text ? 'comment' : null),
  text: r.commentary ?? r.text ?? null,
});
const listResult = (elements: any[], key: 'posts' | 'people', map: (x: any) => unknown, pagination: unknown, missReason: string) =>
  elements.length
    ? { status: 'hit' as const, output: { [key]: elements.map(map), count: elements.length, pagination }, costOverride: elements.length * 0.02 }
    : { status: 'miss' as const, missReason, output: { [key]: [], count: 0 }, costOverride: 0 };

export const harvestapi = defineAdapter({
  name: 'harvestapi',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-09-25 (Apify public prices; direct API plan to verify)', table: PRICE },
  requiredEnv: ['HARVESTAPI_API_KEY'],
  tools: {
    search_posts: {
      description: 'LinkedIn posts matching a keyword query, most recent first.',
      normalize: (i) => ({ search: norm(i.search ?? i.query), postedLimit: String(i.postedLimit ?? 'week'), page: Number(i.page ?? 1) }),
      async execute(i, ctx) {
        const r = await page(ctx, 'post-search', { search: String(i.search), postedLimit: String(i.postedLimit), page: String(i.page) }); // verify against docs
        if ('error' in r) return r.error!;
        return listResult(r.elements!, 'posts', postOut, r.pagination, 'no_posts');
      },
      cost: costFromTable(PRICE.search_posts),
    },
    company_posts: {
      description: 'Recent posts of a company page (competitor monitoring).',
      normalize: (i) => ({ company: String(i.company ?? ''), postedLimit: String(i.postedLimit ?? 'week'), page: Number(i.page ?? 1) }),
      async execute(i, ctx) {
        const r = await page(ctx, 'company-posts', { company: String(i.company), postedLimit: String(i.postedLimit), page: String(i.page) }); // verify against docs
        if ('error' in r) return r.error!;
        return listResult(r.elements!, 'posts', postOut, r.pagination, 'no_posts');
      },
      cost: costFromTable(PRICE.company_posts),
    },
    profile_posts: {
      description: 'Recent posts of a person (tracked CTOs).',
      normalize: (i) => ({ profile: normalizeLinkedin(i.profile ?? i.linkedin_url) ?? '', postedLimit: String(i.postedLimit ?? 'week'), page: Number(i.page ?? 1) }),
      async execute(i, ctx) {
        const r = await page(ctx, 'profile-posts', { profile: String(i.profile), postedLimit: String(i.postedLimit), page: String(i.page) }); // verify against docs
        if ('error' in r) return r.error!;
        return listResult(r.elements!, 'posts', postOut, r.pagination, 'no_posts');
      },
      cost: costFromTable(PRICE.profile_posts),
    },
    post_reactions: {
      description: 'People who reacted to a post.',
      normalize: (i) => ({ post: String(i.post ?? i.post_url ?? ''), page: Number(i.page ?? 1) }),
      async execute(i, ctx) {
        const r = await page(ctx, 'post-reactions', { post: String(i.post), page: String(i.page) }); // verify against docs
        if ('error' in r) return r.error!;
        return listResult(r.elements!, 'people', personOut, r.pagination, 'no_reactions');
      },
      cost: costFromTable(PRICE.post_reactions),
    },
    post_comments: {
      description: 'People who commented on a post, with their comment.',
      normalize: (i) => ({ post: String(i.post ?? i.post_url ?? ''), page: Number(i.page ?? 1) }),
      async execute(i, ctx) {
        const r = await page(ctx, 'post-comments', { post: String(i.post), page: String(i.page) }); // verify against docs
        if ('error' in r) return r.error!;
        return listResult(r.elements!, 'people', personOut, r.pagination, 'no_comments');
      },
      cost: costFromTable(PRICE.post_comments),
    },
    get_profile: {
      description: 'Full LinkedIn profile (current position, company, location). `main:true` for the smaller payload.',
      normalize: (i) => ({ url: normalizeLinkedin(i.url ?? i.linkedin_url) ?? '', main: Boolean(i.main ?? true) }),
      async execute(i, ctx) {
        const r = await page(ctx, 'profile', { url: String(i.url), main: String(i.main) }); // verify against docs
        if ('error' in r) return r.error!;
        const p: any = Array.isArray(r.elements) ? r.elements[0] : r.elements;
        if (!p) return { status: 'miss', missReason: 'no_profile', output: {} };
        const cur = p.currentPosition?.[0] ?? p.experience?.[0] ?? {};
        return { status: 'hit', output: { ...pick(p, ['firstName', 'lastName', 'headline', 'location']), linkedin_url: normalizeLinkedin(p.linkedinUrl ?? i.url), title: cur.position ?? cur.title ?? null, company: cur.companyName ?? cur.company?.name ?? null, company_linkedin: cur.companyLinkedinUrl ?? cur.company?.linkedinUrl ?? null } };
      },
      cost: costFromTable(PRICE.get_profile),
    },
  },
});
