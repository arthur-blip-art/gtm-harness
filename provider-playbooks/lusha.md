# Lusha — agent guidance

**Best for:** phone + email in one reveal, with an `emailConfidence` label and a `doNotCall` flag on phones; strongest on mid-market/enterprise contacts.

**Operations (adapter `src/providers/lusha.ts`, header `api_key`):**
- `enrich_person` — `GET /v2/person?firstName&lastName&companyDomain (or linkedinUrl)&revealEmails&revealPhones` → `{email, email_status (emailConfidence), emails[{email,email_status,type}], phone (E.164), phone_type, phone_status: found|do_not_call|not_found, phones[{phone,raw,phone_type,do_not_call}], firstName, lastName, jobTitle, company{name,domain}}`. Input `reveal: 'email'|'phone'|'both'` (default `both`) is part of the cache key; `phone` prefers `phoneType: mobile`.

**Pricing basis:** per_hit 1 credit when at least one requested contact point is returned; a person found without the requested data is a miss (`no_email_found` / `no_phone_found` / `no_contact_point`). Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- `reveal:'both'` bills once but reveals both; if you only need emails set `reveal:'email'` so a phone-only match does not count as a hit.
- `email_status` is Lusha's confidence label (e.g. `A+`, `A`, `B`), not a validator verdict: map it in the email policy and still validate before sending.
- `phone_status: do_not_call` is a hit (the number exists) but must be suppressed by the calling play — never dial it.
- Numbers without a country prefix are returned as bare digits (not E.164); the adapter does not guess the country.
