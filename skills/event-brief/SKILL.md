---
name: event-brief
description: "Prepare a trade show, conference, congress, summit, meetup or dinner before it happens: read the public speaker, programme, exhibitor and sponsor lists, keep the companies that fit the ICP, cross them with the customer list and the accounts already targeted, rank the people, and deliver a top 5 to meet with a one-page brief each, a route for the day, and a CSV of everyone found. Use this whenever the user mentions an upcoming event and wants to know who will be there, who matters, who to meet, who to book, or how to prepare it: 'qui sera à ce salon', 'prépare Accountex', 'top 5 à rencontrer', 'brief avant l'événement', 'liste des speakers', 'les exposants', 'who should we meet at Money20/20', 'build the event campaign', even if they only paste an event URL. Also use it to build a calendar of upcoming events for a market."
---

# Event brief (read the room before walking into it)

Turn a public event site into a short list of people worth meeting and what to say to each.

**Why it exists.** In markets that meet in person, the best first line is "I see you are on stage Thursday at 11", and the best meeting is the one booked a week before. Done by hand, that preparation takes a day per event. The real risk is the opposite of slowness: a confident brief built on a name, a title or a session time that nobody actually read. So the method is read, classify, rank, re-read, then write, and say plainly what could not be read.

## Declared inputs

Nothing here has a silent default. Look for it first, then ask. Ask the closed questions together as choices, and the one open question on its own: five numbered questions in one message get skimmed.

| Input | Where to look first | If it is missing |
|---|---|---|
| **The event, and the right edition** | the name or URL the user gave | ask. Then confirm dates, city and year on the official site before anything else: an annual event in three cities has no single right answer, and a wrong edition makes every later fact worthless |
| **Which company is going** | the project's context files | ask. Everything is scored against it. Also check whether that company already appears on the event site as exhibitor or sponsor: it changes the goal |
| **What a good person to meet looks like** | `context/icp.md`, `context/product_context.md` | ask in two parts: a choice among customers, partners, investors, hires, then one line of specifics. That line is the rubric. "Anyone senior" produces a list ranked on seniority |
| **Who goes from our side, and the goal** | the request | ask as a choice: just me, a team without a booth, a team with a booth. Five booked meetings and twenty stand visits are different briefs |
| **Customers and competitors** | a CSV with a `domain` column, in a gtm-harness project `gtm-data/<project>/*exclusions*.csv` | ask. Without it, say in the brief that customers could not be separated from targets |
| **Accounts already targeted** | `gtm-data/<project>/final-accounts.csv`, or a CRM export | optional. Say it was not used |
| **Software we connect to or resell** | a catalog file named in the product context | optional but it matters: without it a partner looks like a prospect |
| **An attendee list the user already has** | nothing, people never volunteer it | ask once: this year's, last year's, none. Last year's list says someone may come again, not that they are coming. Label it |
| **Language** | the request | the brief is in the language the user asks for. Draft messages are in the language the person works in, which is usually the event's. Say which was used |
| **Where the files go** | the project's data folder | decide, say so, move on. Scratch files go in a temp folder, never in the project |

## Workflow

### 1. Find the lists

An event site usually has four: speakers, programme, exhibitors, sponsors. Find all four before reading any.

Use `scripts/fetch_page.py <url>` rather than a summarising fetch: a summary silently returns the four names it could see out of fifty. For one page the script prints tables as rows (`--tables`), images with file name, alt text and upload month (`--images`), links grouped by pattern (so 111 session links read as one line), every page of the sitemap and its child sitemaps, and on a WordPress site the content types readable as JSON, which often give the whole speaker list in three calls. It writes the links to a file: feed that file back with `--urls-file` to read every speaker or session page in one command.

When a list is not readable (JavaScript only, a login, a bot check, an attendee app), say so and move to the next source: the sitemap, one page per speaker, exhibitor press releases, sponsor logos and their file names. Names read from logo file names are unconfirmed until one page confirms them. Never fill a hole from last year's edition. The header saying this year proves little: date the content itself, by the upload month of the logos and the date of each press release. Stay on public pages, and do not try to pass a bot check.

When several events share one site and one programme, keep the rooms and tracks of the event the user named, and say how many speakers of the co-located events were left unclassified.

When we go without a booth, read the visitor terms. Some events forbid visitors from selling in the aisles. Then the only play is meetings booked beforehand, and the brief says so at the top.

### 2. Extract people and companies

One row per person, or per company when nobody is named. Keep the columns of `references/output-format.md` and the URL each row was read on. A row without a source is a rumour.

Take every session a person has, with date, start, end and room: this is what makes the message specific and tells the AE where to stand. The programme grid often gives only the start time. The session's own page gives the end and the room.

### 3. Classify each company

| Status | Meaning | What to do with it |
|---|---|---|
| `target` | fits the ICP, not a customer | rank it |
| `already_targeted` | in the list of accounts being worked | one more signal: rank it higher and reuse the existing angle |
| `customer` | in the exclusion list as a customer | an ally: a warm introduction, a shared session, a testimonial on site |
| `competitor` | competitor or adjacent offer | context: what they present, which stand |
| `partner` | software we connect to, a marketplace, an association | not a prospect, sometimes a door |
| `out` | does not fit | leave it out of the people file, keep it in the dropped file with the reason |

Match the exclusion and catalog lists by domain, not by name: brands and legal entities differ. A company can be both software we connect to and a prospect: give it the status that drives the action, and note the other in `why`. A customer list can hold names with no public source: quote as proof only the customers the user can cite publicly, and ask when unsure.

**Spend the effort where it pays.** A large event has hundreds of companies and most are out. Sort cheaply first, by name, exhibitor description and conference track. Then open the company's own site only for the ones that pass, to confirm what they sell and to whom. Resolve domains only for companies you keep, from the link on the event site or one search. After two failed tries leave the domain empty and move on. Say in the brief how many were looked at individually and how many were sorted on the event page alone. Resellers and integrators look like vendors in an exhibitor list: when a company sells someone else's software it is `partner` or `out`.

### 4. Rank the people

Rules, with the reason next to each point, so the user can disagree with a weight instead of distrusting a number. Weights are in `references/scoring.md`. The logic:

- **Can this person decide or strongly influence?** Product, technology, partnerships, a founder in a small company. Sales and marketing are a way to get an introduction, rarely a decision.
- **Is their session on our topic?** A talk about the problem we solve is the strongest signal an event gives.
- **How good is the company, on evidence?** Something read on the company's own site that matches the ICP's best predictor counts for more than fitting the category.
- **Is there a warm path?** Only what the event pages and the user's lists show: a customer on the same panel or stand, a co-sponsor, a customer owned by the same group. Shared investors count only if the user supplies them.
- **Can we find them?** A named session with a time and a room is a place to stand.

Size needs a source. Use the band the event site declares, or the company's own site, and write where it came from. When nothing is found, write "not checked" and do not apply a size rule. Far above the band is a different sales motion. Below about ten people there is rarely a budget: bench them.

One person per company in the top 5. List the others as other doors into the same company.

### 5. Re-read before writing

For the top 5 and five reserves, fetch each person's own speaker and session pages again, fresh, and confirm name, title, company, session title, date, time and room. This is where errors are caught: a time read on a multi-track grid, a changed title, a replaced speaker. If a fact cannot be confirmed, keep the person and drop the fact, and say which.

Use only the professional information the event and the company publish.

### 6. Write the brief

Use `references/output-format.md`. Three files, in the project's data folder or where the user says, named with the slug `<event>-<city>-<year>`:

- `event-brief-<slug>.md`: header, top 5, one brief per person, the route for the day, who else is in the room, limits.
- `event-people-<slug>.csv`: everyone kept, with status, priority, score and reason.
- `event-dropped-<slug>.csv`: every company classified `out`, with the reason, so nothing disappears silently.

A brief per person is short and practical: who they are, why them, where and when, the opening line said out loud in twenty seconds (after their session or at a booked meeting, not a cold approach where the event forbids it), a pre-event message under 60 words, two questions to ask, the warm path, what to avoid. Each cites a fact that was re-read. When the company's own pages gave no fact to cite, open with a question, not with an invented gap.

Add a route: the order of the day, which targets share a stage or a panel, which sessions clash.

### 7. Hand over, with one gate

Report what was readable and what was not, how many companies and people came out by status, and anything surprising (the user's own company listed as exhibitor, a new adjacent competitor).

Everything after this costs money or touches a system, so it is the user's call, asked once with the scope and the cost: enriching emails for the top names, pushing the list to the CRM with an event property, starting a pre-event sequence. In a gtm-harness project: `scripts/push-csv-to-hubspot.mjs` and the `gtm` skill's email plays, both behind their approval gate.

## What this skill touches

- **Reads:** public pages of the event and of the companies kept; the project's context and list files.
- **Writes:** the three output files, and scratch files in a temp folder.
- **Never:** sends a message, books a meeting, enriches an email, writes to a CRM, logs in anywhere, or reads an attendee list behind a login or a bot check.

## What this skill does not claim

- It lists who is on stage, exhibiting or sponsoring. It does not know who attends as a visitor.
- A status of `target` means the company looks like the ICP from public pages. Nobody checked a budget or a project.
- A customer absent from the exclusion list will be treated as a target.
- Headcounts are whatever source is written next to them, often a band the company declared.
- Programmes change until the day. The brief is true on the date it was read, which it states.

## What good looks like

A good brief is one an AE can act on without opening the event site: five people from five companies, each with a place and a time, an opening line that would be false for anyone else, and a reason that was read at the source. It names the customer who can make the introduction. It says "the exhibitor list was not readable, so this is incomplete" when that is the case.

A thin brief has five people from two large groups, sessions without rooms, opening lines that would fit any speaker, a customer listed as a target, and no section on limits. A wrong brief looks exactly like a good one, which is why step 5 exists.

## Building an event calendar

When the user asks which events matter for a market, list candidates, then open each official site and keep only events whose dates were read there. Third-party listings are often wrong by a year. For each: dates, city, URL, audience, whether speaker and exhibitor lists are public, a relevance grade with one line of reason. Say which known events were dropped and why. Format in `references/output-format.md`.

## What goes wrong

| Symptom | Cause | What to do |
|---|---|---|
| Four speakers found on a two-day congress | the fetch summarised, or the list is in a table or embedded JSON | `fetch_page.py --tables`, then `--urls-file` on the links file |
| Exhibitor list looks like another event | template, last year's page, or a commented-out block | check the year, fall back to press releases and logos, say the list is incomplete |
| A customer appears as a target | matched by name | match by domain |
| A partner's CEO lands in the top 5 | no catalog of software we connect to | ask for it, or check the product context |
| The top 5 is five people from two large groups | no size rule, several people per company | one per company, apply the size rule, name the others as other doors |
| A session time that turns out wrong | read from a multi-track grid | re-read on the session's own page |
| Hours spent classifying | every company researched to the same depth | sieve first, research only what passes |
| No exhibitor list anywhere | the button points to a template or a blocked host | `--images` on the page with the logo wall, press releases dated this year, and say about how much is unseen |

---
The declared-inputs, touches, does-not-claim and what-good-looks-like sections follow the structure of Clay's open skill template (MIT, clay-run/clay-skill-creator). The interview questions on edition, attendee list and "what a good person to meet looks like" are adapted from Shy Rahnama's "Get top conference attendees" skill in the same repository.
