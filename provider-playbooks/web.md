# Web (own fetch) — agent guidance

**Best for:** the free layer of everything: a company's own website and DNS. What it sells, to whom, at what price, which customers it names, which tools it runs, whether it hires. No key, no credit, cached like any receipt.

**Operations (adapter `src/providers/web.ts`):**
- `fetch_page` — plain HTTPS GET `{url}` → `{url, title, description, generator, text (≤30k chars), text_length, links[{href,text}], scripts[], markers[], phones[], emails[]}`. Hit when the page has text; `miss` with `unreachable`, `http_404`, `not_html`, `empty_page`.
- `dns_records` — `{domain}` → `{mx[], txt[], dmarc[]}` from the system resolver. SPF includes and TXT verifications name the tools allowed to send mail from the domain (HubSpot, Salesforce, SendGrid, Outreach…).

**Pricing basis:** free. Verified on: 2026-10-08.

**Pitfalls:**
- Single-page apps return an almost empty HTML: `account-context` then renders the homepage once with ScrapeGraph (paid, only when text < 400 chars).
- Some sites block non-browser user agents (403): treat as `miss`, never retry in a loop.
- Key pages are found from the homepage links (`core/discover.ts`), never guessed.
