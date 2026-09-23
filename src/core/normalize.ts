import { getDomain } from 'tldts';

/** NFKC, trim, collapse whitespace, lowercase. */
export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Strip diacritics for ASCII-only email patterns (é → e). */
export function ascii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Name token safe for an email local part: ascii, letters only. */
export function nameToken(s: unknown): string {
  return ascii(norm(s)).replace(/[^a-z]/g, '');
}

/** Apex (registrable) domain from a domain, URL or email host. `www.chift.eu/` → `chift.eu`. */
export function apexDomain(input: unknown): string | null {
  let s = norm(input);
  if (!s) return null;
  s = s.replace(/^mailto:/, '');
  if (s.includes('@')) s = s.split('@').pop() ?? '';
  if (!/^[a-z]+:\/\//.test(s)) s = `http://${s}`;
  try {
    const host = new URL(s).hostname;
    return getDomain(host) ?? null;
  } catch {
    return null;
  }
}

export function normalizeEmail(e: unknown): string | null {
  const s = norm(e);
  if (!s || !s.includes('@')) return null;
  const [local, host] = s.split('@');
  if (!local || !host) return null;
  return `${local}@${host}`;
}

export function emailDomain(e: string): string | null {
  return apexDomain(e);
}

export function normalizeLinkedin(url: unknown): string | null {
  const s = norm(url);
  const m = s.match(/linkedin\.com\/in\/([^/?#]+)/);
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

export function isSalesNavUrl(url: unknown): boolean {
  return /linkedin\.com\/sales\/lead\//.test(norm(url));
}
