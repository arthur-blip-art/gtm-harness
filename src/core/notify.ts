import { env } from '../config.ts';

/**
 * Outbound alerts. Nothing calls us: the scheduler wakes a play, the play diffs against the
 * signals table and pushes what is new here. Slack incoming webhook only for now.
 */
export interface Notifier {
  slack(text: string, blocks?: unknown[]): Promise<'sent' | 'skipped' | 'failed'>;
}

export function createNotifier(opts: { dryRun: boolean; log: (m: string) => void; fetchImpl?: typeof fetch }): Notifier {
  const url = env('SLACK_WEBHOOK_URL');
  const f = opts.fetchImpl ?? fetch;
  return {
    async slack(text, blocks) {
      if (opts.dryRun || !url) {
        opts.log(`[notify${opts.dryRun ? ' dry-run' : ' no SLACK_WEBHOOK_URL'}] ${text.split('\n')[0]}`);
        return 'skipped';
      }
      try {
        const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(blocks ? { text, blocks } : { text }) });
        return res.ok ? 'sent' : 'failed';
      } catch {
        return 'failed';
      }
    },
  };
}
