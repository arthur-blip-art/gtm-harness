/**
 * Lexical routing eval for SKILL.md: does each prompt land on the expected doc/play?
 * Pattern adapted from Cargo's cargo-skills evals (MIT). Offline, deterministic, gates CI on the
 * `core` tier; `hard` cases are reported only. Usage: node --import tsx scripts/routing-eval.ts [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const routes: Record<string, string[]> = JSON.parse(fs.readFileSync(path.join(root, 'evals', 'routes.json'), 'utf8')).routes;
const cases = fs.readFileSync(path.join(root, 'evals', 'routing.jsonl'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('//')).map((l) => JSON.parse(l) as { prompt: string; expect: string; tier: 'core' | 'hard' });
const verbose = process.argv.includes('--verbose');

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function route(prompt: string): { best: string; scores: Record<string, number> } {
  const p = norm(prompt);
  const scores: Record<string, number> = {};
  for (const [r, words] of Object.entries(routes)) {
    scores[r] = words.reduce((acc, w) => acc + (p.includes(norm(w)) ? (w.includes(' ') ? 2 : 1) : 0), 0);
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { best: best[1] > 0 ? best[0] : '(none)', scores };
}

let coreFail = 0, hardFail = 0;
for (const c of cases) {
  const { best, scores } = route(c.prompt);
  const ok = best === c.expect;
  if (!ok) c.tier === 'core' ? coreFail++ : hardFail++;
  if (!ok || verbose) console.log(`${ok ? 'ok  ' : 'FAIL'} [${c.tier}] "${c.prompt}" → ${best}${ok ? '' : ` (expected ${c.expect}; scores ${JSON.stringify(scores)})`}`);
}
const core = cases.filter((c) => c.tier === 'core').length, hard = cases.length - core;
console.log(`routing: core ${core - coreFail}/${core}, hard ${hard - hardFail}/${hard}`);
process.exit(coreFail ? 1 : 0);
