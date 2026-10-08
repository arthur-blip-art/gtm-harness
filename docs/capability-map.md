# Carte des capacités du harnais

État au 2026-10-08, après le refactoring « gratuit d'abord ». Ce document classe ce qui existe par **métier** (ce qu'on cherche à obtenir), dit pour chaque brique comment elle s'exécute et comment elle casse, et quelle source passe en premier.

## Les deux produits

1. **Le bouton (le moteur)** : on lui donne un ICP ou un signal, il rend comptes, bonnes personnes, coordonnées, contexte et brouillons de séquence, sans humain dans la boucle. Il se lance de trois façons : `gtm run prospect`, le workflow GitHub Actions `prospect` (bouton *Run workflow*) et le cron `signals-to-action`.
2. **Le copilote** (Claude Code + `SKILL.md` + recettes) : un humain demande, Claude pilote les mêmes plays et explique les résultats.

Toute la récupération de donnée vit dans les plays. Le jugement (ce qu'une entreprise vend, quel fait ouvre le mail, la rédaction) est un appel LLM *à l'intérieur* du play, en sortie structurée, chaque fait accompagné de son URL source. Ça tourne donc sans Claude Code.

## Les 4 modes d'exécution

| Mode | Où | Tourne seul ? | Comment ça casse |
|---|---|---|---|
| **Play API** | `src/plays/*` avec `src/providers/*` | oui (CLI, Actions, cron) | erreur visible dans le reçu, 429 et 5xx relancés, plafond `--max-credits` |
| **Lecture publique** | adapters `web`, `ats`, `publicweb`, `registry_fr` | oui, gratuit, en cache | `miss` daté et explicite (`unreachable`, `board_not_found`, `no_news`) : jamais d'échec silencieux |
| **Recette agent** | `recipes/*.md`, `skills/event-brief` | non, Claude Code | lecture de l'agent ; les recettes appellent désormais des plays |
| **MCP de session** | FullEnrich, BuiltWith, HubSpot… | non | hors cache et hors reçu : à réserver à l'exploration manuelle |

## Les capacités, de la moins chère à la plus chère

Chaque capacité rend **une donnée, une situation et un timing**, chacun avec sa source.

| Capacité | Play | Gratuit | Peu cher | Payant, seulement pour le manque |
|---|---|---|---|---|
| **Lead gen** | `icp-to-companies` | registre FR par NAF et tranche d'effectif (dirigeants inclus) | lookalikes Exa `find_similar` (~0,005 $), résolution du domaine par Serper (~0,001 $) | Apollo, TheirStack, Crustdata, dimensionnés à 1 ligne avant achat |
| **Bonne personne** | `company-to-people` | dirigeants légaux (FR) pour une demande niveau CEO | dork `site:linkedin.com/in "<titre>" "<entreprise>"` via Serper (~0,001 $ par titre) | FullEnrich search, Apollo, Prospeo |
| **Joindre (email)** | `name-domain-to-email` | | pattern + MillionVerifier, Hunter, LeadMagic, Findymail | Prospeo, Apollo, FullEnrich, Crustdata, PDL |
| **Joindre (téléphone)** | `person-to-phone`, `account-context` | standard affiché sur le site (`tel:`) | standard Google Maps via Serper (~0,003 $) | Lusha, Kaspr, FullEnrich (mobile) |
| **Contexte** | `account-context` | pages du site (pricing, clients, intégrations, carrières, équipe), DNS, offres d'emploi, actualités | un appel LLM par compte | rendu ScrapeGraph pour les sites 100 % JavaScript |
| **Stack technique** | `tech-stack` | DNS (MX, SPF, TXT), source du site, offres d'emploi | | TheirStack (technographie à l'échelle, à brancher) |
| **Signaux d'entreprise** | `company-signals` | board ATS (Greenhouse, Lever, Ashby, Workable, Recruitee), Google News RSS, SEC Form D (US), BODACC (FR) | Serper News si le RSS est vide | PredictLeads, TheirStack, Crustdata (`paid: gap`) |
| **Signaux LinkedIn** | `linkedin-signals` | | HarvestAPI : posts par mot-clé, engagés chez les concurrents, posts suivis, changements de poste des champions | |
| **Ce qui se dit** | `social-listening` | Hacker News, Google News | LinkedIn (HarvestAPI), Reddit et X (ScrapeCreators), web (Exa) | |
| **Signal → action** | `signal-to-action` | | enchaîne personnes, email, contexte et brouillon, une fois par signal | |
| **Séquence** | `draft-sequence` | audit de copy par code (8 règles) | un appel LLM | |
| **Le bouton** | `prospect` | tout ce qui précède, dans l'ordre | | |
| **Livrer** | `sync-hubspot` (optionnel) | | | |

## Pourquoi cette couche publique pour un SaaS B2B généraliste

- **Le site de l'entreprise** est la source la plus juste et elle est gratuite. Il dit ce qu'elle vend (accueil), à qui (clients), comment (pricing), avec quoi (intégrations, scripts chargés) et si elle recrute (carrières).
- **Le board ATS** (Greenhouse, Lever, Ashby…) est la source que les API d'offres d'emploi payantes scrapent. Lu directement, il donne le signal de recrutement, le texte des annonces et les outils qu'elles citent.
- **Le DNS** ne ment pas sur les outils autorisés à envoyer des mails : HubSpot, Salesforce, SendGrid, Outreach.
- **La presse datée** (Google News RSS) couvre levées, nominations, lancements et expansions. Le timing est ce qui fait répondre.
- **Les dépôts légaux** donnent le financement avant le communiqué : Form D pour les levées privées américaines, BODACC pour les changements de capital et de dirigeants en France.
- **Le registre français** (API Recherche d'entreprises) liste tous les éditeurs de logiciels par code NAF (58.29C, 62.01Z…) avec leurs dirigeants légaux : la lead gen et la bonne personne, gratuitement, pour les PME.

## Les trois décisions humaines

1. **Une fois, à l'installation** : l'ICP, les personas dans l'ordre et l'offre (`config/prospect.json`).
2. **Au-delà du budget** : `--max-credits` arrête le run, et le hook `gtm-gate` demande avant tout run payant complet.
3. **Avant que quoi que ce soit sorte** : aucun envoi ni écriture CRM par défaut. Chaque brouillon porte la liste exacte de ce qu'il faut vérifier : fait périmé, source non lue, email pas HIGH ou MEDIUM, règle de copy non respectée.

## Ce qui reste à faire

- La technographie TheirStack en repli payant de `tech-stack`.
- Des adapters ATS pour Welcome to the Jungle, Teamtailor et Personio.
- Les registres UK (Companies House) et US (formulaires SEC hors Form D).
- L'ingestion des visiteurs du site (Snitcher, RB2B), qui demande un pixel installé chez le client.
- Les plays de recettes Chift (`integrations-signal`, le benchmark) à faire entrer dans le moteur sous la forme d'un play générique `page-signal`.
