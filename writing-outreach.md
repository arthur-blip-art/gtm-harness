# Writing outreach and qualification

Inputs: an enriched export (email, confidence, company fields, signals) and a context folder next to the project: `context/icp.md`, `qualification_questions.md`, `product_context.md`, `copy_rules.md`.

## Contracts

**Qualification JSON** per prospect: `score` integer 0–10, `score_label` ("Strong fit: X/10" | "Possible fit: X/10" | "Weak fit: X/10"), `fit_band` (STRONG_FIT | POSSIBLE_FIT | WEAK_FIT), `weights[]` of `{factor, weight, evidence, impact: positive|negative|neutral}`, `confidence` HIGH/MEDIUM/LOW, `summary {positives, risks, next_checks}`. Each qualification question is answered Yes/No/Unknown with evidence; mark Unknown when evidence is missing. Default to higher recall unless strict matching is requested.

**Sequence JSON**: exactly 4 emails (`step` 1..4), each mapped to a pain or risk from the qualification summary; 8 subject-line variants max 7 words each; no clickbait, no ALL CAPS, no exclamation marks; concise, no fluff, no markdown; no claims unsupported by inputs.

## Personalization

Avoid mail-merge output: every email cites something specific (mission, product, recent news, job opening, tech stack, funding). Three paths: a deterministic template from columns; an AI column (Claude writes from the row + context); research column then generation column. Prompt templates: `gtm prompts list --theme "outreach copy"` (e.g. "Use job openings to write email first line", "Leverage Case Studies for Outbound", "Write a brief subject line").

## Templates (run by Claude)

1. Fit scoring rubric (weights + evidence only).
2. Qualification questions (Yes/No/Unknown + confidence + rationale).
3. Research brief (what they build, who they sell to, why now).
4. Sequence writer (4 steps, pains → hooks).
5. QA critic: returns `issues[{step, severity, issue, fix}]` and `revised_emails`.

## Guardrails

Never send from HOLD/LOW rows. Honour `do_not_contact`. Keep the RGPD legitimate-interest wording in every first email (who we are, why we write, how to opt out). Inspect CSVs with `gtm csv show`, never the Read tool.
