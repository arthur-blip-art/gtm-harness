# Recipe: one account to a 3-step sequence

Use when the user names one software vendor and asks for its decision makers, the context, and a sequence
("find me decision makers at Moss and write the sequence"). Built for Chift: the account is a B2B software
vendor, the reason to write is its accounting coverage. Nothing is ever sent: the output is a draft for an AE.

## Steps

1. **Exclusions first.** If the domain is a Chift customer or competitor (`../chift-benchmark/data/chift-accounts.json`,
   or ask the user), stop: a customer goes to the CSM, a competitor is not prospected. Say which, and why.
2. **Read their integrations page** (free, allowed by the gate):
   `node scripts/integrations-signal.mjs --domain <domain> --countries FR,DE,NL,BE,ES`
   Keep `integrations_page_url`, `accounting_today`, `coverage_gap`. The script picks the wrong page about one time in
   three: open `integrations_page_url` and check the list before using it. A product detail page (one ledger) is the
   wrong page; find the list page on the same domain.
3. **Compare with their competitors**, when the vendor is in the coverage benchmark:
   `cd ../chift-benchmark && npx tsx collector/scenarios.ts <domain>:FR,DE` (or the live site,
   `https://connectivity-benchmark-ag.vercel.app/?domain=<domain>&countries=FR`). Keep the gaps where a dominant or
   important ledger is reached by at least 2 out of 3 competitors. Also note one competitor that connects through
   Chift on its own public pages, if the benchmark shows one (green cells): it is the strongest proof.
4. **Look for a timing signal**, with a date and a source URL: funding under 6 months, a new CEO/CTO/CPO or
   partnerships lead in their first 90 days, a live job ad on integrations or partnerships, a new country under
   12 months, an e-invoicing deadline in their own content. None found is a valid answer: say so, never invent one.
5. **People, emails, HubSpot.** Rehearse first if the user has not run it today, then the live run (the gate asks):
   `node scripts/demo-one-account.mjs --domain <domain> --people 2 --max-credits 5` (preview), then the same with
   `--write` once the user confirms. Only HIGH and MEDIUM emails reach HubSpot. Note each contact's title: it picks
   the persona line.
6. **Write the sequence** with the rules below, into `gtm-data/sequences/<domain>.md`, and show it in the reply.
7. **Audit it** (rules 9 and 10) with a script, not by eye, and print the table under the sequence.

## Output, in this order

1. **Context**: one line per fact, each with its source URL and date: what the page lists, the gap per country, the
   competitor comparison, the timing signal (or "none found"), the contacts found (name, title, email confidence).
2. **The first line chosen**, and which rule picked it.
3. **Step 1** (LinkedIn version under 60 words, email version under 120), **step 2**, **step 3**, with subjects.
4. **Audit table**: word count per message (computed), the 8 checks, the score.
5. **What the AE must check** before loading it in LaGrowthMachine: the facts whose source was not re-read.

## Flow

| Day | Step | Channel |
|---|---|---|
| D0 | Profile visit, connection request without a note | LinkedIn (warm-up, not a message) |
| D2 | Step 1: the fact, what it costs them, one offer | LinkedIn if accepted, email otherwise |
| D7 | Step 2: the proof in numbers, a 20-minute ask, the second persona invited | email, same thread |
| D12 | Step 3: the one-word exit | email |

Any reply stops the sequence and opens an AE task. A click on the coverage map alerts the AE.

## Rules

1. **First line = the strongest fact, with its source.** In this order: a ledger most competitors reach and they
   don't (step 3); else what their own page says, country by country (step 2); else the timing signal alone.
2. **State what we read, not what we infer.** Country presence in the benchmark is inferred from connections: write
   "the 7 other expense tools active in France: 6 connect to Cegid Quadra", never "you sell in France without Cegid".
3. **Signals have a shelf life**: funding 6 months, new executive 90 days, job ad while online, new country 12 months.
   Older, it stays out of the message.
4. **Structure of step 1**: the fact; what it costs them (the persona line); what Chift is in one sentence; one offer.
5. **Step 1 offers the coverage map or the benchmark link, never a meeting.** The meeting ask comes in step 2, with
   the second persona named ("with you and your CPO").
6. One number and one reference per message. Never a price.
7. Never claim a gap we did not read: "Sage" on a page is not "Sage 100 missing". Never promise a country Chift does
   not cover (Italy and Poland have no local ledger in the catalog today).
8. Every first email ends with: "Not the right person? Tell me and I won't write again."
9. **Copy audit, 8 checks**: no em or en dash; no rhetorical question as a hook; no compliment without a fact; no
   jargon (leverage, seamless, robust, game-changer, innovative, holistic, best-in-class, empower, streamline,
   unlock, next-level); the body does not start with "I"; no meeting ask in step 1; length; subject of 6 words or
   fewer, sentence case.
10. **Lengths**: step 1 email 120 words, LinkedIn 60, steps 2 and 3 150.

## Persona line (second paragraph of step 1)

| Persona | Line |
|---|---|
| CEO | "In {country} the accountant usually picks the ledger, so a missing connector tends to cost the deal, not just a workaround." |
| CTO | "Each of those is a build, then a maintenance line your team carries for as long as the ledger exists." |
| CPO, Product Manager | "Each of those takes a roadmap slot you could give back to the core product." |
| Partnership Manager | "Each missing ledger is a question prospects ask in the demo, and a partner you cannot list on your marketplace." |

Who picks the ledger, from Chift's 2026 survey: the accountant in France and Germany, the SME itself in the
Netherlands. Use the line only where it is true.

## Proof by segment (step 2), from Chift's public case studies

| Segment | Proof |
|---|---|
| Spend, expense | Pleo spent 12 to 16 weeks per accounting integration in-house; through Chift, four in under six weeks. |
| Banking, payments | Qonto runs its accounting and invoicing integrations across European markets through Chift. |
| HR, workforce | Skello needed 2 weeks of dev per POS integration; through Chift, 30 with a single one. |
| Construction | Graneet and Vertuoza push invoices to their customers' ledgers through Chift. |
| ERP, invoicing | Sellsy and Axonaut deliver their accounting integrations through Chift. |
| Accounting software | Pennylane receives POS, e-commerce and invoicing data through Chift, white-labelled. |

Cost line for step 2: Chift estimates one accounting connector built in-house at 22 to 44k euros, before maintenance.

## Worked example: Moss (getmoss.com), step 1

Facts: integrations page names 17 accounting tools, no Cegid, Pennylane or ACD; benchmark, France: 6 of the 7 other
expense tools connect to Cegid Quadra, all 7 to Cegid Loop; Spendesk's own Sage 100, Odoo, Exact Online and ACD pages
read "Developed by: Spendesk via Chift"; no timing signal found.

> Subject: Moss and the French ledgers
>
> Hi {{first_name}},
>
> Your integrations page names 17 accounting tools, from DATEV and Exact to Sage 50 and NetSuite. None of them is
> Cegid, Pennylane or ACD, the ledgers French accountants mostly run.
>
> I compared the 7 other expense tools active in France: 6 connect to Cegid Quadra, all 7 to Cegid Loop. Spendesk's
> own pages for Sage 100, Odoo, Exact Online and ACD read "Developed by: Spendesk via Chift".
>
> Chift is one API to 50+ European accounting software, maintained by us.
>
> The comparison is online, ledger by ledger, with the source of every cell:
> connectivity-benchmark-ag.vercel.app/?domain=getmoss.com&countries=FR. Shall I send the full report for France?
>
> Not the right person? Tell me and I won't write again.
