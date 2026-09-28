import { describe, expect, it } from 'vitest';
import { AuditColumnError, auditRows, renderAudit } from '../src/core/audit.ts';

describe('gtm audit (email/domain consistency)', () => {
  it('flags apex mismatches and bad emails, skips empty rows, keeps subdomains equal', () => {
    const a = auditRows([
      { full_name: 'A', email: 'a@acme.com', domain: 'www.acme.com' },
      { full_name: 'B', email: 'b@old-employer.io', domain: 'acme.com' },
      { full_name: 'C', email: 'not-an-email', domain: 'acme.com' },
      { full_name: 'D', email: '', domain: 'acme.com' },
    ]);
    expect(a.total).toBe(4);
    expect(a.checked).toBe(3);
    expect(a.mismatches.map((m) => [m.name, m.reason])).toEqual([['B', 'domain_mismatch'], ['C', 'bad_email']]);
    expect(a.warning).toBe(true);
    expect(renderAudit(a)).toMatch(/2\/3 rows mismatched \(67%\)/);
  });
  it('is quiet on a clean file and honours custom column names', () => {
    const a = auditRows([{ mail: 'x@acme.com', site: 'acme.com', first_name: 'X', last_name: 'Y' }], { emailCol: 'mail', domainCol: 'site' });
    expect(a.mismatches).toEqual([]);
    expect(a.warning).toBe(false);
    expect(renderAudit(a)).not.toMatch(/WARNING/);
  });
  it('fails loudly on a missing column', () => {
    expect(() => auditRows([{ email: 'x@acme.com' }])).toThrow(AuditColumnError);
  });
});
