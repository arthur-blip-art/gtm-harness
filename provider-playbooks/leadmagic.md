# LeadMagic — agent guidance

**Best for:** finder that returns the validation status alongside the email; validator that exposes `mx_record`; mobile finder from LinkedIn URL or work email.

**Operations (adapter `src/providers/leadmagic.ts`, header `X-API-Key`):**
- `email_finder` — `POST /email-finder {first_name, last_name, domain}` → `{email, email_status, credits_consumed, company_name, mx_provider, is_domain_catch_all}`. `email_status` in `valid|catch_all|unknown|not_found`.
- `email_validation` — `POST /email-validate {email}` → `{email, email_status, mx_record, needs_second_validator, credits_consumed}`. `email_status` in `valid|invalid|catch_all|unknown`. Hit when `valid` or `catch_all`.
- `mobile_finder` — `POST /mobile-finder {profile_url | work_email}` → `{phone (E.164 when a country prefix is present), phone_status: found|not_found, phone_type: 'mobile', mobile_number (raw), credits_consumed}`.

**Pricing basis:** `credits_consumed` from every response is authoritative and written as `costOverride`. Table fallback: `email_finder` per_hit 1, `email_validation` per_call 0.05, `mobile_finder` per_hit 5. Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- `invalid` + `mx_record` populated = "mailbox not provable", not "mailbox does not exist". The adapter sets `needs_second_validator: true`; escalate to ZeroBounce/MillionVerifier before discarding the address.
- The finder's `email_status` is LeadMagic's own verdict; `catch_all` from the finder still needs the policy's catch-all handling.
- Mobile numbers cost ~5× an email; only call `mobile_finder` on rows already qualified for phone outreach.
- 200 with `email: null` and `status: not_found` is a normal miss (no credits consumed); 4xx carries `message`.
