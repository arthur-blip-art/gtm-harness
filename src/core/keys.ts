import { apexDomain, nameToken, normalizeEmail, normalizeLinkedin } from './normalize.ts';
import { sha256 } from './hash.ts';

/**
 * Stable identity for a person row. Precedence: LinkedIn URL > email > name+apex.
 * Never a row index: reruns and re-uploads must map to the same key.
 */
export function personKey(row: Record<string, unknown>): string {
  const li = normalizeLinkedin(row.linkedin_url);
  if (li) return `li:${li.replace('https://www.linkedin.com/in/', '')}`;
  const email = normalizeEmail(row.email);
  if (email) return `em:${email}`;
  const apex = apexDomain(row.domain) ?? '';
  const first = nameToken(row.first_name);
  const last = nameToken(row.last_name);
  return `nm:${sha256(`${first}|${last}|${apex}`).slice(0, 24)}`;
}

export function companyKey(row: Record<string, unknown>): string | null {
  return apexDomain(row.domain);
}
