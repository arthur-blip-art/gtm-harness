import fs from 'node:fs';
import path from 'node:path';
import { GTM_HOME, env } from '../config.ts';
import { apexDomain, normalizeEmail, normalizeLinkedin } from './normalize.ts';
import type { Store } from '../store/store.ts';

/**
 * Who we never pay to enrich: customers, competitors, opt-outs, hard bounces. Checked BEFORE any
 * provider call, so suppressed rows cost nothing (the CRM-side check in sync-hubspot stays as a
 * second net). Sources: a text file (one domain, email or LinkedIn URL per line; `#` comments),
 * GTM_SUPPRESSION_FILE or config/suppression.txt, plus people flagged do_not_contact in the store.
 */
export interface Suppression { domains: Set<string>; emails: Set<string>; linkedin: Set<string>; size: number }

const cache = new WeakMap<Store, Promise<Suppression>>();

export function loadSuppression(store: Store): Promise<Suppression> {
  let p = cache.get(store);
  if (!p) { p = build(store); cache.set(store, p); }
  return p;
}

async function build(store: Store): Promise<Suppression> {
  const s: Suppression = { domains: new Set(), emails: new Set(), linkedin: new Set(), size: 0 };
  const file = env('GTM_SUPPRESSION_FILE') ?? path.join(GTM_HOME, 'config', 'suppression.txt');
  if (fs.existsSync(file)) {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) continue;
      const li = normalizeLinkedin(line);
      const em = line.includes('@') ? normalizeEmail(line) : null;
      if (li) s.linkedin.add(li);
      else if (em) s.emails.add(em);
      else { const d = apexDomain(line); if (d) s.domains.add(d); }
    }
  }
  for (const p of await store.listPeople()) {
    if (!p.doNotContact) continue;
    if (p.email) s.emails.add(p.email.toLowerCase());
    const li = normalizeLinkedin(p.linkedinUrl);
    if (li) s.linkedin.add(li);
  }
  s.size = s.domains.size + s.emails.size + s.linkedin.size;
  return s;
}

/** The reason a row or an account is suppressed, or null. */
export function suppressedBy(s: Suppression, r: { domain?: string; email?: string; linkedin_url?: string }): string | null {
  const d = apexDomain(r.domain ?? (r.email?.split('@')[1] ?? ''));
  if (d && s.domains.has(d)) return `domain ${d}`;
  const em = r.email ? normalizeEmail(r.email) : null;
  if (em && s.emails.has(em)) return 'email';
  const li = normalizeLinkedin(r.linkedin_url);
  if (li && s.linkedin.has(li)) return 'linkedin';
  return null;
}
