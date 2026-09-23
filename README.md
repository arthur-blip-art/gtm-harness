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
