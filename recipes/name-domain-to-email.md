---
name: name-domain-to-email
description: "Find and verify work emails for a CSV of first name + last name + domain (or company), with a per-row cost trail."
---

# Name + domain → verified work email

Pilot three rows, read the receipt, fix the route, run the full file, export to the exact requested path.

## When to use

- "Find the emails for this CSV"
- "Enrich these 40 contacts with verified emails"
- "Which of these people can we reach at their company address?"

## What NOT to do

| Anti-pattern | What happens | Why it fails |
|---|---|---|
| Read the CSV with the Read tool | Context fills with rows, no output | Use `gtm csv show --csv` |
| Run the full file first | Pay for a bad route at scale | Pilot `--limit 3`, read the receipt |
| Retry misses by hand with other providers | Turns burnt, same misses | Coverage is a property of the company; over-provision instead |
| Trust Apollo `guessed` or PDL emails as sendable | Bounces | They are HOLD until the verifier says `ok` |
| Deliver the pilot export | Task looks done, isn't | The deliverable is the full run at the user's `--out` |
| Put data in /tmp | Lost after the session | `./gtm-data/<slug>/` next to the project |

## Steps

### Step 1: inspect — [transform]

**Input:** the user's CSV path.

```bash
gtm csv show --csv leads.csv
gtm providers
```

**Output:** row count, detected columns, which legs are enabled.
**Checkpoint:** `first_name`, `last_name` and (`domain` or `company`) detected; at least Apollo or FullEnrich configured. If a header is not detected: `--column domain=Site`.
**Fallback:** no key at all → `--dry-run` to show the user the shape of the output, then ask for keys.

### Step 2: pilot — [enrich]

**Input:** the CSV, 3 rows.

```bash
gtm run name-domain-to-email --csv leads.csv --out gtm-data/leads/leads.emails.csv --limit 3 --max-credits 10
```

**Output:** 3 exported rows, receipt table.
**Checkpoint:** every leg with `rowsReached > 0` shows hits or credible misses; no `error:`; emails match the row domain. If a leg is `CUT CANDIDATE`, plan to drop it with `--legs`.
**Fallback:** FullEnrich timeout → rerun; its receipt cache resumes. Apollo 401/403 → key or plan issue, see `provider-playbooks/apollo.md`.

### Step 3: approve when needed — [deliver]

If the user stated the scope, skip. Otherwise post the four-header approval message (Assumptions / CSV Preview (ASCII) / Credits + Scope + Cap / Approval Question) with the pilot's rows, projected credits = rows × pilot marginal credits per accepted, and `Approve full run?`.

### Step 4: full run — [enrich]

```bash
gtm run name-domain-to-email --csv leads.csv --out gtm-data/leads/leads.emails.csv --max-credits <cap>
```

**Output:** full export at the requested path; golden records in `people`.
**Checkpoint:** `status: done`; `sendable (HIGH+MEDIUM)` count; HOLD count. Aborted on cap → report where it stopped, rerun continues from cache.
**Fallback:** high HOLD share with no verifier key → recommend adding `MILLIONVERIFIER_API_KEY` and rerun (`--legs verify` only re-checks held rows at cents per row).

### Step 5: validate and report — [deliver]

```bash
gtm audit --csv gtm-data/leads/leads.emails.csv
```

Show a table (name, domain, email, status, confidence), the receipt line, and one recommendation (keep/drop legs, scale, verifier). Report cost as marginal credits per accepted row.

## Gotchas

| Gotcha | What happens | Fix |
|---|---|---|
| Catch-all domain | Pattern leg stops after first try, later legs return `catch_all` | Accepted as MEDIUM only if two legs agree; else HOLD |
| Company without domain and no Exa key | Row skipped with `missing_input` | Add a domain column or `EXA_API_KEY` |
| Accents in names | Patterns use ASCII (`chloe.dupont@`) | Automatic; providers receive ASCII tokens too |
| Same person in two CSVs | Same `row_key`, same receipts | Free the second time |
| FullEnrich billed while the local run was cancelled | Credits spent, no cells | Rerun: the runner resubmits only uncached rows; check the logged `enrichment_id` in the provider dashboard |
