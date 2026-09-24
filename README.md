# gtm-engine

Moteur GTM maison : la méthode Deepline (cascade d'enrichissement, pilote avant échelle, cache durable, reçu de coûts) avec nos propres clés de providers, sur une base Supabase. Le dépôt est aussi un skill Claude Code (`~/.claude/skills/gtm` → ce dossier).

## Installation

```bash
pnpm install
cp .env.example .env            # puis remplir DATABASE_URL et les clés
npm link                        # rend `gtm` disponible partout (/opt/homebrew/bin/gtm)
ln -s "$PWD" ~/.claude/skills/gtm
```

Base Supabase (nouveau projet, région EU) :

```bash
supabase link --project-ref <ref>
supabase db push                # applique supabase/migrations/*.sql
gtm db ping                     # liste les tables
```

## Utilisation

```bash
gtm providers                                             # clés configurées, base de prix
gtm csv show --csv leads.csv                              # forme du CSV sans le charger
gtm run name-domain-to-email --csv leads.csv --out out.csv --limit 3   # pilote
gtm run name-domain-to-email --csv leads.csv --out out.csv             # run complet (cache : les lignes déjà faites ne coûtent rien)
gtm receipt <run-id>
gtm audit --csv out.csv
```

`--dry-run` fait tourner tout le flux avec des providers simulés, sans base ni clé.

## Ce que le moteur sait faire (phase 2)

- 18 providers (`gtm providers`) ; 11 plays (`gtm plays`) : e-mails, LinkedIn, téléphones, profil entreprise, ICP → entreprises, entreprise → personnes, signaux, scoring, synchro HubSpot, pipeline complet composé.
- Cascade générique par champ (`src/core/waterfall.ts` + politiques `email`, `phone`, `linkedin_url`), composition de plays (`ctx.runPlay`), batch sur CSV avec cellules persistées (`defineRowPlay`).
- Compétences annexes copiées de Deepline : `research.md`, `scoring.md`, `writing-outreach.md`, 181 prompts (`gtm prompts`), validateurs et scripts Python, 28 plays Deepline en référence sous `vendor/` (privé, voir `vendor/NOTICE.md`).

## Structure

- `SKILL.md`, `enriching-and-researching.md`, `recipes/`, `provider-playbooks/`, `references/`, `agents/` : ce que Claude lit.
- `src/core/` : `tools.ts` (cache → adaptateur → reçu), `waterfall.ts`, `email-policy.ts`, `dataset.ts`, `receipt.ts`.
- `src/providers/` : un adaptateur par provider avec sa table de prix.
- `src/plays/` : les workflows (`name-domain-to-email`).
- `src/store/` : Postgres (Supabase) et mémoire.
- `supabase/migrations/` : schéma.
- `scripts/` : validateurs Python copiés de Deepline.

## Tests

```bash
pnpm test        # vitest, hors ligne, providers mock
pnpm typecheck
```
