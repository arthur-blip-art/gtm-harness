# Review loop (human feedback on a run)

Human review of a run without a spreadsheet SaaS in the loop: the review surface is the exported CSV.

Loop: revision → run → assess → decide → next revision. One candidate per turn; an autonomous loop needs a budget and a stopping rule.

1. Export a run (`gtm run … --out review/<slug>.v1.csv`). Add a `notes` column; the reviewer writes free text per row. Never overwrite a reviewed file: each run is a new immutable version (`.v2.csv`).
2. Read the notes back and classify each one: run assessment, general expectation, case expectation (one row), golden case (input + expected output), comparison (v1 vs v2), candidate revision, loop decision.
3. Golden set: `case_id | split (development|holdout) | input_* | expected_* | grading_notes`. Holdout rows are never used to tune; using them consumes them.
4. Output a scorecard, not one number: coverage, precision on golden cases, cost per accepted row, regressions vs the previous version.
5. Standing rules ("never regress on X") become vitest fixtures in `tests/fixtures/` so they are checked on every change.
