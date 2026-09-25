# vendor/ — third-party material, private use only

Everything under `vendor/` was copied verbatim from the Deepline agent skills installed on this
machine by the `deepline` npm package (skills version of 2026-09-23/24) and from the Deepline
prebuilt play catalog fetched with `deepline plays get prebuilt/<name> --source --out`.

- `deepline-plays/<name>/` — the 28 prebuilt play bundles (TypeScript) + `<name>.describe.json` + `catalog.json`.
- `deepline-shared/` — `search-experiment.ts`, `research-experiment.ts`, `corroboration.ts`, `grounded-extraction.ts`,
  `source-plan.ts`, `audience-hash.ts`, the SDK/authoring references and the original SKILL.md of the annex skills.

Deepline publishes these files without a LICENSE. Copyright stays with Deepline. They are kept here
as a private reference for one person's own use, to study patterns and port ideas into `src/`.
This repository is hosted as a **private** GitHub repository (`gtm-harness`) for that reason. Never make it public, never redistribute this folder.

`scripts/query_design.py`, `scripts/evaluate_public_private_corpus.py`, `references/research/query-design.md`
and `evals/last30days-public-private-corpus.json` include logic adapted from `mvanhorn/last30days-skill`
under the MIT License — see `THIRD_PARTY_NOTICES.md` at the repo root (kept verbatim, required by the license).

`prompts.json` (181 templates) comes from `deepline-gtm/prompts.json`; the prompts look like a Clay
template collection of unstated provenance. Same private-use rule.
