import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const hook = path.join(import.meta.dirname, '..', '.claude', 'hooks', 'gtm-gate.sh');
function decide(command: string): string | null {
  const r = spawnSync('sh', [hook], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' });
  if (!r.stdout.trim()) return null;
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
}

describe('gtm-gate hook', () => {
  it('allows read-only and dry-run commands', () => {
    expect(decide('gtm providers')).toBe('allow');
    expect(decide('gtm csv show --csv leads.csv')).toBe('allow');
    expect(decide('gtm run name-domain-to-email --csv a.csv --out b.csv --dry-run')).toBe('allow');
    expect(decide('node bin/gtm.mjs run icp-to-pipeline --input \'{"limit":2}\' --dry-run')).toBe('allow');
    expect(decide('gtm run name-domain-to-email --csv a.csv --out b.csv --limit 3')).toBe('allow');
    expect(decide('gtm db ping')).toBe('allow');
  });
  it('asks on paid full runs, refresh, hubspot writes, signals and schema pushes', () => {
    expect(decide('gtm run name-domain-to-email --csv a.csv --out b.csv')).toBe('ask');
    expect(decide('gtm run name-domain-to-email --csv a.csv --out b.csv --limit 50')).toBe('ask');
    expect(decide('gtm run name-domain-to-email --csv a.csv --out b.csv --limit 3 --refresh')).toBe('ask');
    expect(decide('gtm run sync-hubspot --input \'{}\'')).toBe('ask');
    expect(decide('gtm run sync-hubspot --input \'{"dry_run": true}\'')).toBe('ask'); // still a paid-run shape without --dry-run flag
    expect(decide('gtm signals pull --domains d.txt')).toBe('ask');
    expect(decide('supabase db push')).toBe('ask');
  });
  it('falls through to the normal prompt on anything chained or unrelated', () => {
    expect(decide('gtm providers && rm -rf /')).toBeNull();
    expect(decide('gtm providers | cat')).toBeNull();
    expect(decide('ls -la')).toBeNull();
    expect(decide('echo $HOME')).toBeNull();
  });
});
