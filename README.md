# GTM Harness

Moteur de prospection B2B auto-hébergé, construit pour Chift. Il reprend la **méthode** de Deepline (cascades de fournisseurs, pilote avant échelle, cache d'appels, reçu de coûts, porte d'approbation) et la fait tourner avec **nos propres clés** de fournisseurs de données, sur une base Supabase, avec HubSpot en sortie. Le dépôt est aussi un **skill Claude Code** : Claude lit `SKILL.md` et pilote le moteur en conversation.

> Dépôt privé. `vendor/` contient des copies de matériel Deepline sans licence, à usage de référence personnelle. Voir `vendor/NOTICE.md`.

## Pourquoi

Deepline vend deux choses : des tuyaux vers ~100 fournisseurs, payés en crédits à l'appel, et une méthode encodée en skills. La méthode est ce qui a de la valeur ; les tuyaux, on peut les tenir nous-mêmes, moins cher, et garder la donnée chez nous. Le harness reproduit la méthode et branche les fournisseurs que nous choisissons.

## Ce que ça fait

**Trouver et enrichir des personnes**

| play | entrée | sortie |
|---|---|---|
| `name-domain-to-email` | prénom, nom, domaine ou entreprise | e-mail pro vérifié, cascade de 9 fournisseurs + 2 validateurs |
| `person-linkedin-to-email` | URL LinkedIn | e-mail pro |
| `person-to-linkedin` | prénom, nom, entreprise | URL LinkedIn validée par une porte de nom (52 cas de test) |
| `person-to-phone` | LinkedIn ou nom + domaine | mobile ou ligne directe |

**Trouver et qualifier des entreprises**

| play | entrée | sortie |
|---|---|---|
| `icp-to-companies` | filtres ICP | liste d'entreprises, dimensionnée à 1 ligne par source avant achat |
| `company-enrich` | domaine | profil fusionné par précédence de sources |
| `company-to-people` | domaine, titres | personnes prêtes pour la cascade e-mail |
| `company-signals` | domaine | levées, offres d'emploi, croissance d'effectif → table `signals` |
| `linkedin-signals` | mots-clés, concurrents, profils suivis | posts, engagements et publications LinkedIn → `signals` + alerte Slack |
| `score-accounts` | — | `account_fit` et `account_engagement` par règles auditables |

**Livrer et composer**

| play | rôle |
|---|---|
| `sync-hubspot` | upsert entreprises et contacts, seulement HIGH/MEDIUM, jamais `do_not_contact`, skip par hash |
| `icp-to-pipeline` | ICP → entreprises → personnes → e-mails → HubSpot, un seul run, un seul reçu |

Chaque play existe en version unitaire (`--input`) et, quand ça a du sens, en version lot sur CSV (`--csv --out`).

## Comment ça marche

```
CSV / ICP / watchlist
        │
        ▼
  ┌─ play ──────────────────────────────────────────────┐
  │  cascade par champ (email, phone, linkedin_url)     │
  │  leg 1 → leg 2 → … stop à la première acceptation   │
  │  chaque appel : normalise → hash → cache → reçu     │
  └─────────────────────────────────────────────────────┘
        │                          │
        ▼                          ▼
  Supabase                    Reçu de coûts
  dataset_rows (cellules)     par étape : atteint, trouvé, crédits,
  tool_receipts (cache)       labels NEVER REACHED / CUT CANDIDATE
  companies, people
  signals, scores, crm_sync
        │
        ▼
  export CSV · HubSpot · Slack
```

Principes empruntés à Deepline et tenus par le code :

- **Pilote → prix → correction → run complet.** Tout run payant commence par 3 lignes. Le pilote n'est jamais le livrable.
- **L'ordre est l'économie.** Fournisseurs du moins cher au plus cher ; une ligne acceptée ne descend jamais plus bas.
- **Rien n'est acheté deux fois.** Empreinte de l'entrée normalisée → reçu → cache. Un rerun identique coûte 0.
- **Coût marginal, jamais amorti.** Le reçu attribue chaque reçu une fois, au run qui l'a créé.
- **Statuts et confiance explicites.** `valid` avec domaine concordant → HIGH ; catch-all corroboré par un second validateur → MEDIUM ; le reste est HOLD, jamais envoyé.
- **Porte d'approbation.** Périmètre borné par l'utilisateur = approuvé ; périmètre ouvert = message à 4 sections et question « Approve full run? ».

## Fournisseurs

19 adaptateurs, un fichier chacun dans `src/providers/`, avec table de prix, date de vérification et fiche `provider-playbooks/<nom>.md` : apollo, fullenrich, hunter, zerobounce, leadmagic, prospeo, findymail, millionverifier, peopledatalabs, crustdata, lusha, kaspr, serper, exa, parallel, theirstack, predictleads, harvestapi, hubspot. `gtm providers` dit lesquels ont une clé. Une clé absente désactive la leg, le play tourne quand même.

Les endpoints sont écrits de mémoire et marqués `verify against docs` : le premier pilote réel par fournisseur est obligatoire.

## Installation

```bash
pnpm install
cp .env.example .env            # DATABASE_URL (pooler Supabase, région EU) + clés
npm link                        # commande `gtm` globale
ln -s "$PWD" ~/.claude/skills/gtm

supabase link --project-ref <ref>
supabase db push                # 4 migrations
gtm db ping
```

Sans aucune clé : `--dry-run` fait tourner n'importe quel play avec des fournisseurs simulés et une base en mémoire.

## Utilisation

```bash
gtm plays                                                      # tous les plays et leurs entrées
gtm csv show --csv leads.csv                                   # forme d'un CSV sans le charger
gtm run name-domain-to-email --csv leads.csv --out out.csv --limit 3   # pilote
gtm run name-domain-to-email --csv leads.csv --out out.csv             # complet
gtm run icp-to-companies --input '{"countries":["FR"],"limit":50,"size_only":true}'
gtm run linkedin-signals --input @config/linkedin-signals.chift.json
gtm receipt <run-id> · gtm prompts list · gtm audit --csv out.csv
```

## Signaux et planification

Aucun fournisseur ne nous appelle. Les plays de signaux sont réveillés par **GitHub Actions** : `.github/workflows/linkedin-signals.yml` tourne les jours ouvrés à 06:00 UTC, tire HarvestAPI, compare à la table `signals`, et poste les nouveautés ICP sur Slack. Sans secrets, il tourne en `--dry-run` et reste vert. Détails et alternatives dans `references/scheduling.md`.

Secrets attendus : `DATABASE_URL`, `HARVESTAPI_API_KEY`, `SLACK_WEBHOOK_URL`.

## Le skill Claude Code

`SKILL.md` route vers les documents de méthode :

- `enriching-and-researching.md` — cascades e-mail, téléphone, LinkedIn
- `finding-companies-and-contacts.md` — découverte, ICP, pipeline
- `scoring.md`, `research.md`, `writing-outreach.md` — méthodes portées de Deepline
- `recipes/` — pas à pas avec checkpoints et fallbacks
- `references/` — statuts, reçus, schéma et RGPD, planification, 181 prompts indexés
- `agents/execution-plan-creator.md` — sous-agent qui planifie sans exécuter

## Structure

```
src/core        tools (cache→adaptateur→reçu), waterfall, policies, play, batch, run, receipt, scoring
src/providers   19 adaptateurs + mock déterministe
src/plays       12 plays
src/store       Postgres (Supabase) et mémoire
supabase/       4 migrations
scripts/        validateurs et analyseurs Python (Deepline, autonomes)
config/         listes de surveillance
vendor/         matériel Deepline en référence (privé)
tests/          40 tests vitest, hors ligne
```

## État

- Vérifié : typecheck, 40 tests, tous les plays en dry-run, workflow CI.
- Non vérifié : aucun appel réel à un fournisseur. Bloqué sur la création du projet Supabase et les clés.
- Test manuel réussi le 25 septembre 2026 : 4 CTO de fintechs européennes trouvés par signal (levée, nouveau CTO, intégrations manquantes) et enrichis via FullEnrich pour 4 crédits.

## Licences

Code du harness : privé, © Arthur Grebert. `scripts/query_design.py` et le corpus d'évaluation adaptent du code MIT de `mvanhorn/last30days-skill` (`THIRD_PARTY_NOTICES.md`). `vendor/` : Deepline, sans licence, référence privée uniquement.
