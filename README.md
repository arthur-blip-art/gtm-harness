# GTM Harness

Moteur de prospection B2B en ligne de commande, piloté par un agent de code. Il source et enrichit des entreprises et des personnes chez 19 fournisseurs de données, avec nos propres clés, garde tout dans une base Supabase, détecte des signaux d'achat, score les comptes et pousse les contacts qualifiés dans HubSpot. Le dépôt est aussi un **skill Claude Code** : Claude lit `SKILL.md` et pilote le moteur en conversation, sous le contrôle d'un hook d'approbation.

## Démo en 60 secondes, sans aucune clé

```bash
pnpm install
node bin/gtm.mjs run name-domain-to-email --csv tests/fixtures/3rows.csv --out out.csv --dry-run
```

`--dry-run` remplace les fournisseurs par des simulateurs déterministes et la base par une mémoire. Le run imprime le reçu de coûts, exactement comme un run payant :

```
COST RECEIPT  run=67efce91-53de-4578-94a9-2a1379115174
rows in: 3   accepted: 3   credits: 1.12 (~$0.112)   marginal credits/accepted: 0.3733

| leg            | provider/tool                   | reached | calls | cached | hits | misses | accepted | credits | credits/accepted | label         |
|----------------|---------------------------------|---------|-------|--------|------|--------|----------|---------|------------------|---------------|
| resolve_domain | exa/search                      | 1       | 1     | 0      | 1    | 0      | 1        | 0.05    | 0.05             |               |
| pattern        | millionverifier/verify_patterns | 3       | 3     | 0      | 1    | 2      | 1        | 0.07    | 0.07             |               |
| hunter         | hunter/email_finder             | 2       | 2     | 0      | 0    | 2      | 0        | 0       | -                |               |
| leadmagic      | leadmagic/email_finder          | 2       | 2     | 0      | 0    | 2      | 0        | 0       | -                |               |
| findymail      | findymail/find_from_name        | 2       | 2     | 0      | 0    | 2      | 0        | 0       | -                |               |
| prospeo        | prospeo/enrich_person           | 2       | 2     | 0      | 0    | 2      | 0        | 0       | -                |               |
| apollo         | apollo/people_match             | 2       | 2     | 0      | 1    | 1      | 1        | 1       | 1                |               |
| fullenrich     | fullenrich/bulk_enrich          | 1       | 1     | 0      | 0    | 1      | 0        | 0       | -                |               |
| crustdata      | crustdata/person_enrich         | 0       | 0     | 0      | 0    | 0      | 0        | 0       | -                | NEVER REACHED |
| pdl            | peopledatalabs/person_enrich    | 1       | 1     | 0      | 0    | 1      | 0        | 0       | -                |               |
| verify         | millionverifier/verify          | 0       | 0     | 0      | 0    | 0      | 0        | 0       | -                | NEVER REACHED |
| zerobounce     | zerobounce/validate             | 0       | 0     | 0      | 0    | 0      | 0        | 0       | -                | NEVER REACHED |

status: done   receipts: 16 new / 0 cached   exported: out.csv
rows: 3   sendable (HIGH+MEDIUM): 2   HOLD: 0   none: 1
```

Comment le lire :

- **`reached`** : combien de lignes sont arrivées jusqu'à cette étape. Une ligne acceptée plus haut ne descend jamais plus bas, donc la colonne décroît.
- **`credits/accepted`** : ce que chaque e-mail trouvé a réellement coûté à cette étape. C'est le chiffre qui décide de l'ordre des fournisseurs.
- **`NEVER REACHED`** : les étapes moins chères avaient déjà répondu. `CUT CANDIDATE` marquerait une étape qui dépense sans jamais accepter.
- Relancer la même commande coûte 0 : chaque appel est mis en cache par empreinte de son entrée normalisée (`receipts: 0 new / 16 cached`).

## Pourquoi

Les plateformes de type Clay sont des harnais : une interface qui revend de la donnée à l'unité, enchaîne des workflows et branche des fournisseurs entre eux. La valeur est dans l'orchestration, pas dans l'interface, et la donnée est facturée deux fois, par le fournisseur puis par la plateforme.

Un agent de code n'a pas besoin de l'interface. Il lui faut une ligne de commande fiable, une méthode qui l'empêche de gaspiller des crédits, et une base où la donnée reste. C'est ce que fait ce dépôt : cascades ordonnées par le coût, pilote avant échelle, cache d'appels, reçu de coûts, porte d'approbation, sur nos fournisseurs, avec notre schéma, sans intermédiaire.

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

Principes tenus par le code, pas par la documentation :

- **Pilote → prix → correction → run complet.** Tout run payant commence par 3 lignes. Le pilote n'est jamais le livrable.
- **L'ordre est l'économie.** Fournisseurs du moins cher au plus cher ; une ligne acceptée ne descend jamais plus bas. Un test de contrat vérifie que chaque cascade est triée par prix.
- **Rien n'est acheté deux fois.** Empreinte de l'entrée normalisée → reçu → cache. Un rerun identique coûte 0.
- **Coût marginal, jamais amorti.** Chaque reçu est attribué une fois, au run qui l'a créé.
- **Statuts et confiance explicites.** `valid` avec domaine concordant → HIGH ; catch-all corroboré par un second validateur → MEDIUM ; le reste est HOLD, jamais envoyé.
- **Porte d'approbation.** Périmètre borné par l'utilisateur = approuvé ; périmètre ouvert = message à 4 sections et question « Approve full run? ». Un hook Claude Code (`.claude/hooks/gtm-gate.sh`) laisse passer lecture, `--dry-run` et pilotes ≤ 3 lignes, et demande confirmation pour tout run payant, tout `--refresh`, toute écriture HubSpot et tout `supabase db push`.

## Décisions de conception

- **Cascade « leg-major », sémantique « row-sequential ».** L'étape 1 tourne sur toutes les lignes, puis l'étape 2 sur celles encore vides, etc. Une ligne acceptée à l'étape N n'atteint jamais N+1, comme dans une cascade ligne par ligne, mais les fournisseurs qui acceptent des lots peuvent grouper leurs appels.
- **Une opération payante par cellule.** Chaque étape écrit sa propre colonne (`email_result__hunter`), la valeur finale `email` est une projection. L'historique de la décision reste lisible dans l'export.
- **Identités stables.** Un reçu est indexé par (fournisseur, outil, sha256 de l'entrée normalisée) ; une ligne par LinkedIn, sinon e-mail, sinon nom + domaine apex, jamais par index. Renommer une identité est une migration.
- **Un échec est un résultat typé.** `miss` porte une raison (`no_email_found`, `domain_mismatch`), jamais un `null` silencieux. Le gagnant est choisi par une boucle ordonnée, pas par un `??`.
- **Les validateurs sont des étapes.** Vérification d'e-mail après les finders, sur les seules lignes en HOLD : un validateur à 0,01 crédit évite d'acheter un troisième finder.
- **Les politiques sont pures.** `email-policy.ts`, `phone-policy.ts`, `linkedin-policy.ts` décident statut, acceptation et confiance sans toucher un fournisseur ; elles sont testées seules.
- **Les écritures externes portent une clé d'idempotence.** `crm_sync.last_hash` : un contact inchangé n'est jamais renvoyé à HubSpot.
- **La règle d'approbation est appliquée, pas suggérée.** Le hook PreToolUse lit la commande avant exécution ; la politique du skill devient un contrôle mécanique, testé.

## Fournisseurs

19 adaptateurs, un fichier chacun dans `src/providers/`, avec table de prix, date de vérification et fiche `provider-playbooks/<nom>.md` : apollo, fullenrich, hunter, zerobounce, leadmagic, prospeo, findymail, millionverifier, peopledatalabs, crustdata, lusha, kaspr, serper, exa, parallel, theirstack, predictleads, harvestapi, hubspot. `gtm providers` dit lesquels ont une clé. Une clé absente désactive la leg, le play tourne quand même.

Les endpoints sont écrits d'après les documentations publiques et marqués `verify against docs` : le premier pilote réel par fournisseur est obligatoire avant tout run à l'échelle.

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

## Utilisation

```bash
gtm plays                                                      # tous les plays et leurs entrées
gtm csv show --csv leads.csv                                   # forme d'un CSV sans le charger
gtm run name-domain-to-email --csv leads.csv --out out.csv --limit 3   # pilote
gtm run name-domain-to-email --csv leads.csv --out out.csv             # complet
gtm run icp-to-companies --input '{"countries":["FR"],"limit":50,"size_only":true}'
gtm run linkedin-signals --input @config/linkedin-signals.chift.json
gtm receipt <run-id>                                           # reçu figé d'un run
gtm audit --csv out.csv                                        # cohérence e-mail / domaine, exit 1 au-delà de 20 % d'écarts
```

## Signaux et planification

Aucun fournisseur ne nous appelle. Les plays de signaux sont réveillés par **GitHub Actions** : `.github/workflows/linkedin-signals.yml` tourne les jours ouvrés à 06:00 UTC, tire HarvestAPI, compare à la table `signals`, et poste les nouveautés ICP sur Slack. Sans secrets, il tourne en `--dry-run` et reste vert. Détails et cadences dans `references/scheduling.md`.

Secrets attendus : `DATABASE_URL`, `HARVESTAPI_API_KEY`, `SLACK_WEBHOOK_URL`.

## Le skill Claude Code

`SKILL.md` route vers les documents de méthode :

- `enriching-and-researching.md` — cascades e-mail, téléphone, LinkedIn
- `finding-companies-and-contacts.md` — découverte, ICP, pipeline
- `scoring.md`, `research.md`, `writing-outreach.md` — scoring, recherche de sources, rédaction
- `recipes/` — pas à pas avec checkpoints et fallbacks
- `references/` — statuts, reçus, schéma et RGPD, planification, exactitude des contacts
- `agents/execution-plan-creator.md` — sous-agent qui planifie sans exécuter

Le routage est lui-même testé : `evals/routing.jsonl` contient des demandes en français et en anglais avec le document attendu, et `scripts/routing-eval.ts` vérifie en CI que chacune atterrit au bon endroit.

## Structure

```
src/core        tools (cache→adaptateur→reçu), waterfall, policies, play, batch, run, receipt, scoring, audit
src/providers   19 adaptateurs + mock déterministe
src/plays       12 plays
src/store       Postgres (Supabase) et mémoire
supabase/       4 migrations
config/         listes de surveillance
tests/          14 fichiers, 52 tests vitest, hors ligne
evals/          évals de routage du skill
.claude/        hook d'approbation gtm-gate (Claude Code)
```

## Qualité

La CI (`.github/workflows/ci.yml`) enchaîne typecheck, tests, évals de routage et trois runs `--dry-run` (cascade e-mail, pipeline complet, signaux LinkedIn). Les tests de contrat (`tests/contracts.test.ts`) tiennent les invariants : chaque cascade e-mail est triée du moins cher au plus cher et ne contient aucun outil téléphone ; chaque fournisseur a une fiche qui nomme chacun de ses outils et une date de vérification des prix ; la synchronisation HubSpot n'envoie que HIGH et MEDIUM et respecte `do_not_contact` ; le hook d'approbation autorise, demande ou s'abstient sur des commandes réelles.

## État

**Vérifié** : typecheck, 52 tests, tous les plays en dry-run, CI verte. Un test manuel réel le 25 septembre 2026 : 4 CTO de fintechs européennes trouvés par signal (levée, nouveau CTO, intégrations manquantes) et enrichis via FullEnrich pour 4 crédits.

**Non vérifié** : les tarifs et endpoints des autres fournisseurs sont des estimations marquées `verify against docs` ; aucun run réel à l'échelle ; le projet Supabase de production reste à créer.

**Prochaines étapes** : un pilote réel par fournisseur avec reçu committé, puis remplacer le reçu de démonstration ci-dessus par un reçu réel.

## Licence

MIT, © Arthur Grebert. Voir `LICENSE`.
