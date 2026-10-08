# Carte des capacités du harnais

État au 2026-10-08. Ce document classe ce qui existe par **métier** (ce qu'on cherche à obtenir), pas par fichier, et dit pour chaque brique comment elle s'exécute et comment elle casse. Il sert de base au refactoring.

## Les deux produits qu'on construit

1. **Un moteur qui tourne seul** (le bouton) : ICP en entrée ; comptes, bonnes personnes, coordonnées, contexte et timing en sortie, sans humain dans la boucle.
2. **Un copilote** (Claude Code + `SKILL.md` + recettes) : un humain demande, Claude pilote le moteur et apporte le jugement.

Règle de partage : **tout ce qui est récupération de donnée va dans le moteur** (plays, testés, avec cache et reçu de coûts). Le copilote ne garde que le jugement et l'écriture. Aujourd'hui, une partie de la récupération vit encore dans les recettes et les scripts, donc elle exige Claude ou casse sans prévenir.

## Les 4 modes d'exécution

| Mode | Où | Tourne seul ? | Comment ça casse |
|---|---|---|---|
| **Play API** | `src/plays/*` avec `src/providers/*` | oui (CLI, CI, cron) | erreur HTTP 4xx ou quota. Le 429 et les 5xx sont relancés (`_adapter.ts`), l'échec est visible dans le reçu |
| **Script HTTP** | `scripts/*.mjs`, `skills/event-brief/scripts/fetch_page.py` | oui, mais hors moteur | silencieusement : une page change de structure, un dictionnaire rate un nom, sans cache ni reçu |
| **Recette ou skill agent** | `recipes/*.md`, `skills/event-brief`, `SKILL.md` | non : Claude Code et un humain | si personne ne la lance, ou si l'agent lit mal (d'où les étapes « re-lire » des recettes) |
| **MCP** | connecteurs de la session (FullEnrich, BuiltWith, HubSpot, Instantly…) | non : session Claude | le moteur ne les utilise pas. Ils font doublon avec nos adapters et ne passent ni par le cache ni par le reçu |

## Les capacités métier

Chaque capacité doit rendre **une donnée, une situation et un timing**, chacun avec sa source.

### 1. Lead gen : trouver les comptes

| Brique | Mode | Sources | Limite |
|---|---|---|---|
| `icp-to-companies` | play API | Apollo, TheirStack, Crustdata (bases payantes, dimensionnées à 1 ligne avant achat) | aucune source publique ou gratuite avant les bases payantes |
| `recipes/find-accounts.md` + `../chift-benchmark` | recette + collecteur hors dépôt | pages d'intégrations et marketplaces, scrapées par mots-clés, puis vérifiées par Claude | spécifique à Chift, vit dans un autre dépôt, Claude obligatoire |
| `scripts/integrations-signal.mjs` | script HTTP | `fetch` des pages d'intégrations + dictionnaire | fragile, hors cache et hors reçu |

**Manque** : un étage public et gratuit avant les bases payantes. En France, il s'agit de l'API Recherche d'entreprises (code NAF, département, tranche d'effectif, dirigeants), des certifications (RGE ADEME…), du BODACC, puis de la recherche Serper (dorks Google, Maps) et des lookalikes Exa.

### 2. Trouver la bonne personne dans le compte

| Brique | Mode | Sources |
|---|---|---|
| `company-to-people` | play API | FullEnrich search, puis Apollo, puis Prospeo |
| `person-to-linkedin` | play API | Serper `site:linkedin.com/in`, puis Exa, avec une porte de validation du nom |

**Manque** : les dirigeants légaux (gratuits via le registre, l'idéal pour les PME), la page équipe du site, une recherche Serper par titre (`"directeur commercial" "<entreprise>" site:linkedin.com/in`) et la recherche de profils HarvestAPI. Apollo est utilisé en recherche alors qu'il coûte 0,01 $ par appel quel que soit le nombre de résultats.

### 3. Joindre : email et téléphone

| Brique | Mode | Sources |
|---|---|---|
| `name-domain-to-email` | play API | pattern + MillionVerifier, puis Hunter, LeadMagic, Findymail, Prospeo, Apollo, FullEnrich, Crustdata, PDL, puis vérification |
| `person-linkedin-to-email` | play API | Prospeo, Findymail, Kaspr, Lusha, Apollo, PDL |
| `person-to-phone` | play API | Lusha, Kaspr, FullEnrich |

C'est la partie la plus mûre : cascades ordonnées par le coût réel, cache et politique de statut. **Manque** : le standard de l'entreprise (Google Maps via Serper, registre), qui est souvent la meilleure voie pour une PME, avant de payer un mobile.

### 4. Contexte : comprendre le compte avant d'appeler

| Brique | Mode |
|---|---|
| étape 2-4 de `recipes/account-to-sequence.md` | recette agent : Claude lit les pages et cherche sur le web |
| `skills/event-brief` | skill agent : `fetch_page.py` + lecture et classement par Claude |

**Manque** : un play `account-context`. Il lirait le site (gratuit), les actualités via Serper News (~0,001 $), et lancerait une recherche Parallel ou Exa seulement si besoin. Une extraction LLM en sortie structurée, appelée depuis le play, permettrait de tourner sans Claude Code.

### 5. Signaux : situation et timing

| Brique | Mode | Sources |
|---|---|---|
| `company-signals` | play API | PredictLeads (levées, offres), TheirStack (offres), Crustdata (effectif) |
| `linkedin-signals` | play API, **cron GitHub Actions** en semaine, alerte Slack | HarvestAPI (posts, engagements) |

**Manque** :
- des signaux publics gratuits : BODACC (changement de dirigeant, augmentation de capital, nouvel établissement), Serper News, flux RSS, pages carrières ;
- **le chaînage signal → action** : un signal enregistré ne déclenche ni la recherche de personnes, ni l'email, ni le brief.

### 6. Livrer

| Brique | Mode |
|---|---|
| `sync-hubspot` | play API (HIGH et MEDIUM seulement, jamais `do_not_contact`) |
| `icp-to-pipeline` | play API composé : ICP, entreprises, personnes, emails, HubSpot |
| `scripts/push-csv-to-hubspot.mjs`, `demo-one-account.mjs`, `score-universe.mjs`, `hubspot-domains.mjs` | scripts spécifiques Chift, qui doublonnent en partie les plays |

## Principe de coût : le contexte d'abord

Pour chaque capacité, l'ordre est le suivant :
1. **gratuit et contextuel** : registres publics, certifications, site de l'entreprise ;
2. **recherche bon marché** : Serper (~0,001 $), Exa (~0,005 $) ;
3. **API à 0,01 $** : Apollo, Hunter ;
4. **cascades payantes** ;
5. **agents de recherche chers** : Parallel, PDL.

Exemple : des dirigeants d'installateurs de pompes à chaleur. On part de l'API Recherche d'entreprises avec le NAF 43.22B, qu'on croise avec la certification RGE QualiPAC. On obtient ainsi les dirigeants gratuitement, puis l'email par pattern + vérification, et le standard via Maps. Les bases payantes ne servent qu'en complément.

## Feuille de route proposée

1. **Étage public gratuit** : adapters `recherche-entreprises` (NAF, dirigeants), `rge` et `bodacc`, plus Serper `places` et `news`. On les branche en tête de `icp-to-companies`, de `company-to-people` et de `company-signals`.
2. **Play `account-context`** : site, news et recherche, puis extraction structurée. Il remplace la lecture ad hoc des recettes.
3. **Chaînage signal → action** : un signal qualifié lance `company-to-people`, la cascade email et `account-context`, puis HubSpot. On l'exécute dans le cron existant.
4. **Faire entrer les scripts dans le moteur** : `integrations-signal` devient un play `page-signal` générique, avec cache et reçu. Le collecteur `chift-benchmark` se branche via un CSV ou un adapter.
5. **Les recettes deviennent minces** : elles appellent des plays et ne gardent que le jugement (choix du first line, rédaction, audit).
