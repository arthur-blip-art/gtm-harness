/** Best-effort E.164: keeps a leading `+` (or `00` prefix), strips everything else. Returns null when there is nothing usable. */
export function toE164(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (s.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  // No country prefix: cannot infer safely. Returned as digits only (not E.164); callers may prefix by country.
  return digits;
}
