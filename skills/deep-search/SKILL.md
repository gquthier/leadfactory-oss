---
name: deep-search
description: Produit les 3 études de recherche marché d'un client (conscience du marché, concurrents, psychographie) sous forme de 3 rapports Markdown sourcés, à partir d'une niche, d'un produit, d'une géographie et d'un ICP. À utiliser pour "deep search", "étude de marché", "recherche concurrentielle", "psychographic research" ; pas pour analyser les publicités Meta des concurrents (competitor-ads-research).
---

# Deep Search

Trois études, trois rapports. L'utilisateur fournit le client ; le skill génère les prompts de recherche, exécute la recherche web avec les outils disponibles, et sauvegarde les rapports.

## Entrées

- `niche`, `product`, `geography` (défaut France), `target_avatar`, `competitor_type` (type de produit concurrent à chercher), `details` (optionnel).
- Si un `{CLIENT_DIR}/00-onboarding/onboarding-form.md` existe, le lire pour pré-remplir. Sinon demander le minimum : niche, produit, ICP, type de concurrent. Ne pas lancer sans ces 4 éléments.
- Dossier de sortie : `{CLIENT_DIR}/01-deep-search/`.

## Exécution

1. Construire les 3 prompts à partir de [references/prompts.md](references/prompts.md) en remplaçant uniquement les variables. Ajouter en fin de prompt la consigne de sortie en français centrée sur le marché cible.
2. Lancer les 3 études (en parallèle si l'environnement permet des sous-agents, sinon l'une après l'autre) avec les outils de recherche web disponibles. Objectif par étude : 10 à 15 requêtes, sources citées (URL + date), verbatims de prospects réels (forums, avis, commentaires, réseaux).
3. Si aucun outil de recherche web n'est disponible, le dire et proposer un rapport d'hypothèses clairement étiqueté comme non sourcé, ou s'arrêter. Ne jamais fabriquer de sources.
4. Sauvegarder :

```
{CLIENT_DIR}/01-deep-search/
├── 01-market-awareness.md
├── 02-competitor-research.md
└── 03-psychographic.md
```

## Contenu attendu par rapport

- Résumé exécutif.
- Toutes les sections demandées par le prompt, sans en sauter.
- Citations sourcées, tableaux quand utile.
- Synthèse finale et recommandation.

Pour le rapport 1 : sélection finale du stade de conscience dominant (1 Unaware à 5 Most Aware) et répartition estimée, avec le niveau de confiance. Pour le rapport 2 : fiche par concurrent (cible, funnels, messages, hooks récurrents, prix, ce que les clients aiment et détestent). Pour le rapport 3 : réponses aux questions RMBC avec verbatims.

Les estimations de taille de marché et de chiffre d'affaires sont des ordres de grandeur avec leur source ; sans source, écrire "non trouvé".

## Livrable au format document

Si l'utilisateur veut un PDF ou un DOCX, utiliser un outil de conversion présent sur sa machine (pandoc, LibreOffice, ou un skill de génération de documents). Le Markdown reste la source ; ne pas promettre un document qui n'a pas été généré.

## Message de fin

Chemins des 3 fichiers, 2 à 3 lignes de résultat clé par rapport, étape suivante suggérée (analyse d'offre, vsl-copywriter ou meta-ads-copywriter).

## Règles

- Ne pas modifier les templates de prompt hors variables.
- Toujours en français, toujours sourcé.
- Étude trop légère → relancer avec une consigne de volume plus stricte, une fois.
