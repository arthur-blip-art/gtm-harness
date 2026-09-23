# Writing outreach and scoring (phase 2, not built yet)

Prompt templates (`prompts.json`) and scoring rubrics will live here. For now, use the enriched export (email, confidence, company) with the Mio-era skills in `Mio/.claude/skills/` (`copywriting-refiner`, `pain-identifier`) or Deepline's `writing-outreach.md`.

Scoring will follow `deepline-scoring`'s contract: rules-based `account_fit` / `lead_fit`, reasons stored in `scores.reasons`, HOLD when inputs are missing, never a score derived from phrase counts alone.
