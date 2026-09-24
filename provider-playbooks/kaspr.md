# Kaspr — agent guidance

**Best for:** work email (cheap) and mobile phone (expensive) from a LinkedIn profile; European coverage is strong.

**Operations (adapter `src/providers/kaspr.ts`, Bearer token):**
- `linkedin_profile` — `POST /profile/linkedin {id: <linkedin slug>, name?, dataToGet: ['workEmail'] | ['phone'] | both, isPhoneRequired:false}` → `{email, email_status: valid|invalid|unknown, emails[{email,valid}], phone (E.164), phone_type, phone_status: found|not_found, phones[{phone,raw,phone_type}], linkedin_url, name, title, company}`. `dataToGet` (default `['workEmail']`) is part of the cache key.

**Pricing basis:** per_hit — `costOverride` = 1 credit if a phone was requested *and* returned + 0.05 if a work email was requested *and* returned; misses cost 0. Verified on: estimate 2026-09-24, verify against docs.

**Pitfalls:**
- Phones are 20× the price of a work email: run `dataToGet:['workEmail']` as an email leg and a separate `['phone']` leg only on rows already qualified for calling.
- `isPhoneRequired:false` means Kaspr may return a profile with an email and no phone; the adapter treats that as a hit for the email leg and a miss for the phone leg.
- `id` is the `/in/<slug>` segment of the LinkedIn URL; Sales Navigator URLs are not accepted — resolve them to a public profile first.
- `email_status` comes from `workEmails[].valid` (boolean); `unknown` when the field is absent — still validate before sending.
