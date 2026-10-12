# Contrôle des coûts

Comment le harness évite de dépenser trop. Ces règles sont dans le code (`src/core/budget.ts`, `src/core/estimate.ts`, `src/core/suppression.ts`), testées dans `tests/cost-control.test.ts`, et comparées à ce que font Deepline, Cargo, GooseWorks et LeadMagic.

## Les sept protections, dans l'ordre où elles agissent

| # | Protection | Quand | Réglage |
|---|---|---|---|
| 1 | **Exclusions** : clients, concurrents, opt-outs, hard bounces | avant tout appel | `config/suppression.txt` ou `GTM_SUPPRESSION_FILE`, plus les `do_not_contact` en base |
| 2 | **Disqualification** : comptes hors ICP d'après ce qu'on sait déjà (effectif, pays) | avant les signaux et les personnes (`prospect`) | les filtres de l'ICP ; une donnée inconnue n'exclut jamais |
| 3 | **Estimation** : pire cas en dollars, sans rien dépenser | avant le run | `gtm run … --estimate` |
| 4 | **Plafond par run en dollars**, vérifié *avant* chaque appel payant contre son prix maximal | pendant le run | `--max-usd`, `GTM_MAX_USD_PER_RUN` (défaut 5 $) |
| 5 | **Période d'essai** : une étape payante sans aucun résultat sur ses 5 premières lignes est coupée pour le reste du run | pendant le run | `GTM_DEMOTE_AFTER` (0 désactive) |
| 6 | **Cache** : un même appel n'est jamais acheté deux fois ; un rerun reprend là où le run s'est arrêté | toujours | `--refresh` pour racheter volontairement |
| 7 | **Budget mensuel** tenu sur le registre des reçus : avertissement à 80 %, refus des runs payants à 100 % | au lancement | `GTM_MONTHLY_BUDGET_USD`, `gtm budget` |

En plus : la cascade est ordonnée du moins cher au plus cher, les sources gratuites passent en premier, et les fournisseurs payés au résultat sont préférés aux fournisseurs payés à l'appel.

## Ce que le plafond garantit, et ce qu'il ne garantit pas

- Le plafond est en **dollars**, calculé depuis la table de prix de chaque adapter. Les crédits n'ont pas la même valeur d'un fournisseur à l'autre, c'est pour ça qu'on ne plafonne plus en crédits.
- Avant chaque appel, le harness prend le **pire cas** : un appel payé au résultat compte comme un résultat, un appel payé par ligne retournée compte comme une page pleine. Si ça ne tient pas, l'appel n'est pas fait. Une étape de cascade qui ne peut pas payer toutes ses lignes traite seulement celles qu'elle peut payer, puis le run s'arrête proprement.
- Le dépassement possible est donc **l'erreur de la table de prix**, pas une étape entière. Tant que les prix ne sont pas vérifiés sur les tableaux de bord des fournisseurs (`gtm providers`, colonne `verified`), ce sont des estimations.

## Ce qui reste à faire

- **Vérifier les prix** pendant le pilote réel : comparer chaque reçu au tableau de bord du fournisseur et corriger la table.
- **Lire le solde réel** chez les fournisseurs qui l'exposent (Cargo et Deepline interrogent leur API de facturation avant de chiffrer).
- **Budget par campagne** (LeadMagic : pas plus de 40 % du budget mensuel sur une seule campagne).
