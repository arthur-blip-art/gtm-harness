import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { checkDomain } from './email-policy.ts';

export interface AuditOptions {
  emailCol?: string;
  domainCol?: string;
  nameCol?: string;
}

export interface AuditMismatch {
  name: string;
  email: string;
  domain: string;
  reason: 'domain_mismatch' | 'bad_email';
}

export interface AuditResult {
  total: number;
  checked: number;
  mismatches: AuditMismatch[];
  /** Mismatch rate over checked rows, 0..1. */
  rate: number;
  /** Above 20% the contact-finding step most likely picked wrong people. */
  warning: boolean;
}

export class AuditColumnError extends Error {
  constructor(public column: string, public available: string[]) {
    super(`column '${column}' not found. Available: ${available.sort().join(', ')}`);
  }
}

/**
 * Email/domain consistency audit on an exported CSV: every row whose email apex differs from the
 * company apex is a wrong-person or previous-employer candidate. Read-only, never rewrites the file.
 */
export function auditRows(rows: Record<string, string>[], opts: AuditOptions = {}): AuditResult {
  const emailCol = opts.emailCol ?? 'email';
  const domainCol = opts.domainCol ?? 'domain';
  const nameCol = opts.nameCol ?? 'full_name';
  if (rows.length) {
    const headers = Object.keys(rows[0]);
    for (const col of [emailCol, domainCol]) if (!headers.includes(col)) throw new AuditColumnError(col, headers);
  }
  const mismatches: AuditMismatch[] = [];
  let checked = 0;
  for (const r of rows) {
    const email = (r[emailCol] ?? '').trim();
    const domain = (r[domainCol] ?? '').trim();
    if (!email || !domain) continue;
    checked++;
    const c = checkDomain(email, domain);
    if (!c.ok) mismatches.push({ name: r[nameCol] || `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '?', email, domain, reason: c.reason });
  }
  const rate = checked ? mismatches.length / checked : 0;
  return { total: rows.length, checked, mismatches, rate, warning: rate > 0.2 };
}

export function auditCsv(file: string, opts: AuditOptions = {}): AuditResult {
  const rows: Record<string, string>[] = parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, bom: true, trim: true });
  return auditRows(rows, opts);
}

export function renderAudit(a: AuditResult): string {
  const lines = a.mismatches.map((m) => `MISMATCH  ${m.name} — ${m.email} vs ${m.domain} (${m.reason})`);
  lines.push(`\n${a.mismatches.length}/${a.checked} rows mismatched (${Math.round(a.rate * 100)}%), ${a.total - a.checked} rows without email or domain skipped`);
  if (a.warning) lines.push('WARNING: >20% mismatch — the contact-finding step needs better disambiguation before any send.');
  return lines.join('\n');
}
