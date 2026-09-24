import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import type { Cells, FieldCell, LegCell, RowState } from './types.ts';
import { apexDomain, norm } from './normalize.ts';
import { personKey } from './keys.ts';

/** Accepted header aliases → canonical column. Matching is case/space/accents-insensitive. */
const ALIASES: Record<string, string[]> = {
  first_name: ['first_name', 'firstname', 'first', 'prenom', 'prénom', 'given_name'],
  last_name: ['last_name', 'lastname', 'last', 'nom', 'surname', 'family_name'],
  full_name: ['full_name', 'name', 'fullname', 'nom_complet'],
  domain: ['domain', 'company_domain', 'website', 'site', 'url', 'domaine', 'company_website'],
  company: ['company', 'company_name', 'organization', 'entreprise', 'societe', 'société'],
  linkedin_url: ['linkedin_url', 'linkedin', 'linkedin_profile', 'profile_url'],
  email: ['email', 'work_email', 'e-mail', 'mail'],
  title: ['title', 'job_title', 'poste', 'role'],
};

export function detectColumns(headers: string[], overrides: Record<string, string> = {}): Record<string, string> {
  const map: Record<string, string> = {};
  const normalizedHeaders = headers.map((h) => [h, norm(h).replace(/[\s-]+/g, '_')] as const);
  for (const [canon, aliases] of Object.entries(ALIASES)) {
    if (overrides[canon]) {
      map[canon] = overrides[canon];
      continue;
    }
    for (const [orig, n] of normalizedHeaders) {
      if (aliases.includes(n)) {
        map[canon] = orig;
        break;
      }
    }
  }
  return map;
}

export interface LoadedCsv {
  path: string;
  headers: string[];
  columns: Record<string, string>;
  rows: Record<string, string>[];
}

export function loadCsv(file: string, overrides: Record<string, string> = {}, limit?: number): LoadedCsv {
  const text = fs.readFileSync(file, 'utf8');
  const raw: Record<string, string>[] = parse(text, { columns: true, skip_empty_lines: true, bom: true, trim: true });
  const headers = raw.length ? Object.keys(raw[0]) : [];
  const columns = detectColumns(headers, overrides);
  const rows = (limit ? raw.slice(0, limit) : raw).map((r) => {
    const out: Record<string, string> = { ...r };
    for (const [canon, src] of Object.entries(columns)) out[canon] = r[src] ?? '';
    if (!out.first_name && !out.last_name && out.full_name) {
      const parts = out.full_name.trim().split(/\s+/);
      out.first_name = parts[0] ?? '';
      out.last_name = parts.slice(1).join(' ');
    }
    if (out.domain) out.domain = apexDomain(out.domain) ?? out.domain;
    return out;
  });
  return { path: file, headers, columns, rows };
}

export function toRowStates(rows: Record<string, string>[], existing: Map<string, Cells>, keyFn: (r: Record<string, string>) => string = personKey): RowState[] {
  return rows.map((input) => {
    const rowKey = keyFn(input);
    return { rowKey, input, cells: existing.get(rowKey) ?? {}, candidates: {} };
  });
}

export function summarizeCsv(file: string): string {
  const { headers, columns, rows } = loadCsv(file);
  const lines = [`file: ${file}`, `rows: ${rows.length}`, `headers: ${headers.join(', ')}`, 'detected columns:'];
  for (const [k, v] of Object.entries(columns)) lines.push(`  ${k} ← ${v}`);
  const missing = ['first_name', 'last_name'].filter((k) => !columns[k]);
  if (missing.length) lines.push(`WARNING missing: ${missing.join(', ')}`);
  if (!columns.domain && !columns.company) lines.push('WARNING no domain or company column');
  const sample = rows.slice(0, 2);
  if (sample.length) lines.push('sample:', JSON.stringify(sample, null, 2));
  return lines.join('\n');
}

/** Flat export: original columns, then the decision for `field`, then one summary column per leg. */
export function exportCsv(out: string, rows: RowState[], legIds: string[], runId: string, originalHeaders: string[], field = 'email') {
  const records = rows.map((r) => {
    const cell = r.cells[field] as FieldCell | undefined;
    const rec: Record<string, unknown> = {};
    for (const h of originalHeaders) rec[h] = r.input[h] ?? '';
    for (const c of ['first_name', 'last_name', 'domain']) if (!(c in rec)) rec[c] = r.input[c] ?? '';
    rec.row_key = r.rowKey;
    rec.run_id = runId;
    rec[field] = cell?.value ?? '';
    rec[`${field}_status`] = cell?.status ?? '';
    rec[`${field}_source`] = cell?.source ?? '';
    rec.confidence = cell?.confidence ?? '';
    rec.miss_reason = cell?.missReason ?? '';
    for (const id of legIds) rec[`${field}_result__${id}`] = legSummary(r.cells[`${field}_result__${id}`] as LegCell | undefined);
    return rec;
  });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, stringify(records, { header: true }));
  return records;
}

export function legSummary(c: LegCell | undefined): string {
  if (!c) return 'not_reached';
  const cached = c.cached ? ' (cached)' : '';
  switch (c.status) {
    case 'hit':
      return `hit:${c.value}:${c.rawStatus ?? ''}${cached}`;
    case 'miss':
      return `miss:${c.missReason ?? 'no_match'}${c.value ? `:${c.value}` : ''}${cached}`;
    case 'error':
      return `error:${(c.missReason ?? '').replace(/^leg_error:/, '').slice(0, 80)}`;
    case 'skipped':
      return `skipped:${c.missReason ?? ''}`;
    default:
      return 'not_reached';
  }
}
