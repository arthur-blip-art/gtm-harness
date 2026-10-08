import { costFromTable, defineAdapter, errorResult, httpJson } from './_adapter.ts';
import { env } from '../config.ts';

/**
 * ScrapeCreators: public social data (X/Twitter, Reddit, LinkedIn, TikTok, Instagram, YouTube, ad
 * libraries) behind one key, pay-as-you-go credits that never expire. Used here for what HarvestAPI
 * does not cover: Reddit threads and X posts for social listening. Endpoint list:
 * https://docs.scrapecreators.com/openapi.json. Header `x-api-key`. Prices: estimate, verify.
 */
const PRICE = {
  reddit_search: { basis: 'per_call', credits: 0.02, note: '~1 credit per request; ~$0.002 on the larger packs (estimate)' },
  twitter_user_tweets: { basis: 'per_call', credits: 0.02, note: '~1 credit per request (estimate)' },
} as const;

const get = (path: string, params: Record<string, string>) => async (ctx: Parameters<NonNullable<import('../core/types.ts').ToolDef['execute']>>[1]) =>
  httpJson(ctx, `https://api.scrapecreators.com${path}?${new URLSearchParams(params)}`, { headers: { 'x-api-key': env('SCRAPECREATORS_API_KEY') ?? '' } });

export const scrapecreators = defineAdapter({
  name: 'scrapecreators',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-10-08 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['SCRAPECREATORS_API_KEY'],
  tools: {
    reddit_search: {
      description: 'Reddit posts matching a query (title, subreddit, url, score, created).',
      normalize: (i) => ({ query: String(i.query ?? '').trim(), sort: String(i.sort ?? 'new'), timeframe: String(i.timeframe ?? 'month') }),
      async execute(i, ctx) {
        const { status, body } = await get('/v1/reddit/search', { query: String(i.query), sort: String(i.sort), timeframe: String(i.timeframe) })(ctx); // verify against docs
        if (status !== 200) return errorResult(status, body, body?.message);
        const posts = (body?.posts ?? body?.data ?? []).map((p: any) => ({ title: p.title, url: p.url ?? (p.permalink ? `https://www.reddit.com${p.permalink}` : null), subreddit: p.subreddit ?? p.subreddit_name_prefixed ?? null, score: p.score ?? p.ups ?? null, comments: p.num_comments ?? null, created_at: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : (p.created_at ?? null), text: String(p.selftext ?? '').slice(0, 400) }));
        return posts.length ? { status: 'hit', output: { posts, count: posts.length } } : { status: 'miss', missReason: 'no_posts', output: { posts: [], count: 0 } };
      },
      cost: costFromTable(PRICE.reddit_search),
    },
    twitter_user_tweets: {
      description: 'Recent tweets of an X/Twitter handle.',
      normalize: (i) => ({ handle: String(i.handle ?? '').replace(/^@/, '').trim().toLowerCase() }),
      async execute(i, ctx) {
        const { status, body } = await get('/v1/twitter/user-tweets', { handle: String(i.handle) })(ctx);
        if (status !== 200) return errorResult(status, body, body?.message);
        const tweets = (body?.tweets ?? body?.data ?? []).map((t: any) => ({ text: String(t.full_text ?? t.text ?? t.legacy?.full_text ?? '').slice(0, 400), url: t.url ?? (t.rest_id ? `https://x.com/${i.handle}/status/${t.rest_id}` : null), created_at: t.created_at ?? t.legacy?.created_at ?? null, likes: t.favorite_count ?? t.legacy?.favorite_count ?? null }));
        return tweets.length ? { status: 'hit', output: { handle: i.handle, tweets, count: tweets.length } } : { status: 'miss', missReason: 'no_tweets', output: { handle: i.handle, tweets: [], count: 0 } };
      },
      cost: costFromTable(PRICE.twitter_user_tweets),
    },
  },
});
