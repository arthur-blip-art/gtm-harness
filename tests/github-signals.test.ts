import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { executePlay } from '../src/core/run.ts';
import { resolvePlay } from '../src/plays/index.ts';
import { play, type Output } from '../src/plays/github-signals.ts';

const quiet = () => {};
const input = { sdk_queries: ['"@codat" filename:package.json'], repos: ['https://github.com/codatio/client-sdk-typescript'] };

describe('github-signals (mock)', () => {
  it('excludes forks and bots, ignores personal logins, maps logins to company domains; idempotent', async () => {
    const store = new MemoryStore();
    const r1 = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r1.status).toBe('done');
    const o = r1.output!;
    expect(o.by_type).toEqual({ github_sdk_user: 1, github_stargazer: 1, github_issue: 1 });
    expect(o.domains.sort()).toEqual(['billwise.io', 'retailco.fr']);
    expect(o.ignored_logins).toEqual(['jdoe']); // user with no blog
    const logins = o.signals.map((s) => (s.value as any).login);
    expect(logins).not.toContain('someone'); // fork
    expect(logins).not.toContain('dependabot'); // bot
    const issue = o.signals.find((s) => s.type === 'github_issue')!;
    expect(issue).toMatchObject({ domain: 'billwise.io', value: { competitor: 'codat', issue_title: 'Support for Exact Online integration' } });
    expect(o.signals.find((s) => s.type === 'github_sdk_user')!.value).toMatchObject({ competitor: 'codat', repo: 'billwise/backend' });
    expect(o.notified).toBe('skipped');

    const r2 = await executePlay<Output>({ store, resolvePlay, play, input, dryRun: true, log: quiet });
    expect(r2.output).toMatchObject({ new_signals: 0, notified: 'none' });
    expect(store.signals.size).toBe(3);
  });
  it('enrich runs company-enrich and score-accounts on new domains only', async () => {
    const store = new MemoryStore();
    const r = await executePlay<Output>({ store, resolvePlay, play, input: { ...input, enrich: true, notify: false }, dryRun: true, log: quiet });
    expect(r.output!.enriched).toBe(2);
    expect((await store.listCompanies()).map((c) => c.domain).sort()).toEqual(['billwise.io', 'retailco.fr']);
    expect(store.scores.size).toBeGreaterThan(0);
  });
});
