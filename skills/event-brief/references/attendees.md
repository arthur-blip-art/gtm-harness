# Attendees: guest lists from Luma, Partiful, Eventbrite, Meetup and conference pages

Speakers, exhibitors and sponsors are published by the organiser. Attendees publish themselves, a little, on the platform they registered on. This layer is thinner and less reliable than the other three, so it never replaces them: it adds rows next to them.

## Getting the list

Read the event page first with `scripts/fetch_page.py`, even when the guest list is hidden: it gives the edition, the host, the audience described in the blurb and the guest count, which are the context for everything below. Then take the first route that works.

1. **Public on the page.** The list is in the fetched HTML or text. Save it as is and parse it.
2. **Visible to the user, not to a fetch.** The page renders the list in JavaScript, or only shows it to people who registered. Ask once, plainly: "Open the guest list, click the 'see all' button, scroll to the end, select all (Cmd+A), copy and paste it here." Screenshots work too: transcribe them, one person per line. If the user cannot see the list either, stop there and say so. Do not retry the fetch with other headers, do not look for the platform's internal API, do not ask for their login.
3. **Not visible at all.** Say the attendee layer is missing and continue with speakers, exhibitors and sponsors.

Ask for the paste once. If the user does not want to, do not insist: the brief is still useful without it, and its limits section says the attendee layer was not read.

## Platform notes (unverified)

What each platform shows changes with its settings and its releases. These notes are a starting point observed on some pages, not a specification: check what the page actually shows, and say what you saw.

| Platform | Usually public | Usually behind registration | Parser option |
|---|---|---|---|
| Luma (lu.ma, luma.com) | hosts, guest count, a few avatars; sometimes the full list | the full list; a one-line bio per guest when the host allows it | `--platform luma` |
| Partiful | title, hosts, guest count | display names by status (going, maybe, can't go), no bio, no company | `--platform partiful` |
| Eventbrite | almost nothing about attendees | first name and initial at best; the full report is the organiser's | `--platform eventbrite` |
| Meetup | often a list of display names, sometimes handles | profiles | `--platform meetup` |
| Conference attendee pages, apps | nothing, or a networking app behind a login | the attendee app | `--platform conference` |

Eventbrite and Partiful lists are mostly first names: say so before parsing, and expect few matches. A networking app behind a login is the same as any login in this skill: not read.

## Parsing rules

Run `python3 scripts/parse_guest_list.py <pasted.txt> --platform <p> --source "<event URL or 'pasted by user YYYY-MM-DD'>" --out <tmp>/guests.csv`, then read its summary line back to the user before matching ("38 people, 11 with a stated company, 9 first names only").

- **Never invent a title or a company.** They are filled only when the guest wrote them explicitly ("Head of Product at Fakturo", "CTO @ Billtrail", "Fondateur chez ...", "... bij ..."). Everything else stays in `raw_bio`. Do not deduce a company from a name, a photo, an e-mail domain or a vague bio ("passionate about SaaS").
- **A guest without a company is still a row.** Keep it in the people file with an empty company and priority 3. It can be matched later, by the user or on re-read; it cannot be ranked.
- **Every attendee row is `UNVERIFIED`** in the `check` column. A bio is self-declared and may be years old. It becomes `confirmed` only when the company's own site or the person's public professional profile says the same thing, and the URL goes in `source_url`.
- **Partial names** (`Marc D.`, a first name, a handle) stay rows, flagged `partial_name=yes`. Do not search for who they might be.
- **Hosts** are a row with `list_status=host`: the host's company is often the best warm path in the room.
- **Duplicates** across statuses or pastes are merged on name and company; the summary says how many.

## Privacy

- Only what the page publishes to the user: name, the bio line, a professional profile link the guest put there. Nothing from the person's private accounts.
- No personal e-mails or phone numbers. The parser removes them from the output and counts them; do not copy them anywhere else. Finding a work e-mail later is the gated enrichment step, with the user's approval.
- A guest list is shared with registrants, not published to the world. Use it to prepare conversations at the event, not to start a cold sequence to everyone on it; that is the user's decision, asked at the hand-over gate, and the brief notes where the list came from.

## Matching attendees to the ICP and the accounts

Attendee rows go through the same steps as the others, with three differences.

1. **Sieve on the stated company only.** Guests without a stated company skip classification. For the others, resolve the domain the usual way (the company's site, one search, two tries) and match exclusions and accounts by domain. A name match is a lead, not a match.
2. **Role is `attendee`** in `roles_at_event`, joined with `+` when the person is also a speaker or exhibitor. A target company with both a speaker and an attendee is two doors, and the attendee is often the easier one.
3. **Scoring.** The title is unconfirmed, so the decision-role points apply only after step 5 confirms it; until then score the company, not the person. An attendee has no session and no stand: the "findable" point does not apply, and the brief's "where and when" is a meeting to book before the day. An attendee from an `already_targeted` account or a customer is worth a line in the brief even with no confirmed title.

In the brief, keep attendees in their own block under "Also in the room" unless one of them makes the top 5 after re-read. The limits section states the list's source, its date, how many rows had no company, and that registered is not the same as present.
