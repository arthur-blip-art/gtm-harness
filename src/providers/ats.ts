import { defineAdapter, errorResult, httpJson } from './_adapter.ts';
import type { ToolResult } from '../core/types.ts';

/**
 * Public job boards of the ATS a company uses. Free, no key, and the most reliable hiring signal
 * for a B2B SaaS: the board is the source the paid job APIs scrape. The board slug is read from
 * the careers page links (see core/discover.ts). Endpoints: verify against each ATS's docs.
 */
const PRICE = {
  greenhouse_jobs: { basis: 'free', credits: 0 },
  lever_jobs: { basis: 'free', credits: 0 },
  ashby_jobs: { basis: 'free', credits: 0 },
  workable_jobs: { basis: 'free', credits: 0 },
  recruitee_jobs: { basis: 'free', credits: 0 },
} as const;

export interface AtsJob { title: string; url: string | null; location: string | null; department: string | null; posted_at: string | null; text?: string }

const day = (v: unknown): string | null => {
  if (typeof v === 'number') return new Date(v).toISOString();
  if (typeof v === 'string' && v) { const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toISOString(); }
  return null;
};
const done = (jobs: AtsJob[], board: string, ats: string): ToolResult =>
  jobs.length ? { status: 'hit', output: { ats, board, jobs, count: jobs.length } } : { status: 'miss', missReason: 'no_open_jobs', output: { ats, board, jobs: [], count: 0 } };
const slugInput = (i: Record<string, unknown>) => ({ board: String(i.board ?? '').trim().toLowerCase() });

export const ats = defineAdapter({
  name: 'ats',
  pricing: { usdPerCredit: 0, verifiedOn: '2026-10-08 (free public boards)', table: PRICE },
  requiredEnv: [],
  tools: {
    greenhouse_jobs: {
      description: 'Open jobs on a Greenhouse board (boards.greenhouse.io/<board>).',
      normalize: slugInput,
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(String(i.board))}/jobs?content=true`);
        if (status === 404) return { status: 'miss', missReason: 'board_not_found', output: { board: i.board } };
        if (status !== 200) return errorResult(status, body);
        const jobs: AtsJob[] = (body?.jobs ?? []).map((j: any) => ({ title: j.title, url: j.absolute_url ?? null, location: j.location?.name ?? null, department: j.departments?.[0]?.name ?? null, posted_at: day(j.first_published ?? j.updated_at), text: stripHtml(j.content).slice(0, 1500) }));
        return done(jobs, String(i.board), 'greenhouse');
      },
      cost: () => 0,
    },
    lever_jobs: {
      description: 'Open jobs on a Lever board (jobs.lever.co/<board>).',
      normalize: slugInput,
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `https://api.lever.co/v0/postings/${encodeURIComponent(String(i.board))}?mode=json`);
        if (status === 404) return { status: 'miss', missReason: 'board_not_found', output: { board: i.board } };
        if (status !== 200) return errorResult(status, body);
        const jobs: AtsJob[] = (Array.isArray(body) ? body : []).map((j: any) => ({ title: j.text, url: j.hostedUrl ?? null, location: j.categories?.location ?? null, department: j.categories?.team ?? null, posted_at: day(j.createdAt), text: String(j.descriptionPlain ?? '').slice(0, 1500) }));
        return done(jobs, String(i.board), 'lever');
      },
      cost: () => 0,
    },
    ashby_jobs: {
      description: 'Open jobs on an Ashby board (jobs.ashbyhq.com/<board>).',
      normalize: slugInput,
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(String(i.board))}`);
        if (status === 404) return { status: 'miss', missReason: 'board_not_found', output: { board: i.board } };
        if (status !== 200) return errorResult(status, body);
        const jobs: AtsJob[] = (body?.jobs ?? []).map((j: any) => ({ title: j.title, url: j.jobUrl ?? null, location: j.location ?? null, department: j.department ?? null, posted_at: day(j.publishedAt), text: String(j.descriptionPlain ?? '').slice(0, 1500) }));
        return done(jobs, String(i.board), 'ashby');
      },
      cost: () => 0,
    },
    workable_jobs: {
      description: 'Open jobs on a Workable board (apply.workable.com/<board>).',
      normalize: slugInput,
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(String(i.board))}`);
        if (status === 404) return { status: 'miss', missReason: 'board_not_found', output: { board: i.board } };
        if (status !== 200) return errorResult(status, body);
        const jobs: AtsJob[] = (body?.jobs ?? []).map((j: any) => ({ title: j.title, url: j.url ?? j.shortlink ?? null, location: [j.city, j.country].filter(Boolean).join(', ') || null, department: j.department ?? null, posted_at: day(j.published_on ?? j.created_at) }));
        return done(jobs, String(i.board), 'workable');
      },
      cost: () => 0,
    },
    recruitee_jobs: {
      description: 'Open jobs on a Recruitee board (<board>.recruitee.com).',
      normalize: slugInput,
      async execute(i, ctx) {
        const { status, body } = await httpJson(ctx, `https://${encodeURIComponent(String(i.board))}.recruitee.com/api/offers/`);
        if (status === 404) return { status: 'miss', missReason: 'board_not_found', output: { board: i.board } };
        if (status !== 200) return errorResult(status, body);
        const jobs: AtsJob[] = (body?.offers ?? []).map((j: any) => ({ title: j.title, url: j.careers_url ?? null, location: j.location ?? null, department: j.department ?? null, posted_at: day(j.published_at ?? j.created_at), text: stripHtml(j.description).slice(0, 1500) }));
        return done(jobs, String(i.board), 'recruitee');
      },
      cost: () => 0,
    },
  },
});

function stripHtml(s: unknown): string {
  return String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
