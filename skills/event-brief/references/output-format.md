# Output formats

Slug: `<event>-<city>-<year>`, lowercase, hyphens. Example: `accountex-madrid-2026`.

## event-people-<slug>.csv

`event,company,domain,segment,headcount,headcount_source,roles_at_event,stand,person_name,person_title,sessions,first_session_time,room,source_url,status,priority,score,why`

- `roles_at_event`: one or more of exhibitor, sponsor, speaker, partner, joined with `+`
- `sessions`: every session, `YYYY-MM-DD HH:MM-HH:MM room: title`, joined with ` | `
- `first_session_time`: `YYYY-MM-DD HH:MM`, empty when not read
- `status`: target / already_targeted / customer / competitor / partner
- `why`: one factual sentence, quotable as is, in the language of the brief

## event-dropped-<slug>.csv

`company,domain,role_at_event,reason,source_url`

## events-calendar.csv

`event,start_date,end_date,city,country,url,audience,speakers_list_url,exhibitors_list_url,relevance,notes`

## event-brief-<slug>.md

```markdown
# <Event>, <city>, <dates>

**Why this event:** one or two sentences on the audience and why it matters for us.
**Read on <date>:** the pages actually read. **Looked at individually:** N companies of M.

## Top 5 to meet

| # | Person | Company | Where and when | Why |
|---|---|---|---|---|

## Briefs

### 1. <Name>, <title>, <company>

- **Who:** two lines, professional facts only.
- **Why them:** the reason, the fact behind it, where it was read.
- **Where and when:** every session with date, time and room; the stand.
- **Opening line (out loud, 20 seconds):** ...
- **Pre-event message (under 60 words, draft, language: ...):** ...
- **Ask:** two questions that move the conversation.
- **Warm path:** who can introduce, or "none found".
- **Other doors at this company:** other people on site, one line each.
- **Avoid:** a fact not confirmed, a size outside the band, a country we do not cover.

(repeat for 2 to 5)

## Route

Day by day, in order: where to be and when, which targets share a stage, which sessions clash and which one to pick.

## Reserve

Three to five more names, one line each.

## Also in the room

- **Customers:** who, and what they are doing there.
- **Competitors and adjacent offers:** who, stand or session.
- **Accounts already targeted:** who, and how the event changes the approach.
- **Our own company on the site:** listed as exhibitor or sponsor, or not.

## Limits of this run

What was not readable, what was not checked, what is incomplete.

## Next steps (your call)

Enrich emails for the top names, push the list to the CRM with an event property, start the pre-event sequence. Scope and cost for each.
```

## A filled example of one brief

### 1. Jean de Broissia, founder and managing director, Praxedo

- **Who:** founder of Praxedo, field service management software, about 150 people, sells in France, Germany and Spain.
- **Why them:** already in the target list for a coverage gap. Their German connector page lists Business Central, Sage 100, SAP and MyFactory, and no DATEV or Lexware (read on praxedo.com).
- **Where and when:** Wed 14 Oct, 10:00-10:45, room ASIMOV, on AI in field interventions; stand E14.
- **Opening line:** "I read your German connector page before coming: Sage 100 and SAP, no DATEV. Is Germany where your customers ask for it most?"
- **Pre-event message (draft, French):** "Bonjour Jean, je serai à TechSolutions le 14 et j'irai écouter votre intervention de 10h. Votre page connecteurs Allemagne cite Sage 100 et SAP, pas DATEV. Dix minutes sur votre stand après la session ?"
- **Ask:** which ledger do German customers request first; who owns connectors on the product side.
- **Warm path:** none found.
- **Other doors at this company:** none on site.
- **Avoid:** do not claim Sage is missing, their pages list Sage 100.
