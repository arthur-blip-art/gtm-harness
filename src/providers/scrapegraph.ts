import { costFromTable, defineAdapter, errorResult, httpJson } from './_adapter.ts';
import { env } from '../config.ts';

/**
 * ScrapeGraphAI: an LLM scraper as a service. Give it a URL and a prompt (and optionally a JSON
 * schema), it renders the page (JavaScript included) and returns structured JSON. Here it is the
 * fallback when our own fetch gets an empty page (single-page apps). Header `SGAI-APIKEY`.
 * Credits: ~5 to 10 per SmartScraper call depending on the plan generation; verify on the dashboard.
 */
const PRICE = { smartscraper: { basis: 'per_call', credits: 0.5, note: '~5-10 ScrapeGraph credits per page (~$0.02-0.05), estimate' } } as const;

export const scrapegraph = defineAdapter({
  name: 'scrapegraph',
  pricing: { usdPerCredit: 0.1, verifiedOn: '2026-10-08 (estimate, verify against docs)', table: PRICE },
  requiredEnv: ['SCRAPEGRAPH_API_KEY'],
  tools: {
    smartscraper: {
      description: 'Render a page and extract what the prompt asks, as JSON (optional output_schema).',
      normalize: (i) => ({ url: String(i.url ?? '').trim(), prompt: String(i.prompt ?? '').trim(), ...(i.output_schema ? { output_schema: i.output_schema } : {}) }),
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, 'https://api.scrapegraphai.com/v1/smartscraper', { // verify against docs
          method: 'POST',
          headers: { 'content-type': 'application/json', 'SGAI-APIKEY': env('SCRAPEGRAPH_API_KEY') ?? '' },
          body: JSON.stringify({ website_url: i.url, user_prompt: i.prompt, ...(i.output_schema ? { output_schema: i.output_schema } : {}) }),
        });
        if (status !== 200) return errorResult(status, body, body?.detail ?? body?.error);
        const result = body?.result ?? null;
        return result ? { status: 'hit', output: { url: i.url, result } } : { status: 'miss', missReason: 'empty_result', output: { url: i.url } };
      },
      cost: costFromTable(PRICE.smartscraper),
    },
  },
});
