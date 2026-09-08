# Templates des 3 prompts de recherche

Variables : `{NICHE}`, `{PRODUCT}`, `{GEOGRAPHY}`, `{DETAILS}` (optionnel), `{COMPETITOR_TYPE}`, `{AVATAR}`.

Suffixe à ajouter à chaque prompt : « Rends le résultat en français, recherche centrée sur le marché {GEOGRAPHY}. Cite chaque affirmation avec une URL et une date. Retourne uniquement le rapport Markdown, sans préambule. »

## Prompt 1 — Conscience du marché

```
Évalue le niveau de conscience du marché pour un produit dans l'espace {NICHE}. Le produit précis est {PRODUCT}. Marché : {GEOGRAPHY}. Contexte additionnel : {DETAILS}.

Utilise les 5 niveaux attribués à Eugene Schwartz :
1. Unaware — ne perçoit ni problème ni besoin.
2. Problem Aware — reconnaît le problème, ignore les solutions.
3. Solution Aware — sait que des solutions existent, ignore la nôtre.
4. Product Aware — connaît des produits similaires, compare.
5. Most Aware — connaît bien la catégorie, proche de l'achat.

Pour cet exercice, « Product Aware » et « Most Aware » portent sur des produits quasi identiques et les marques qui les proposent, pas sur notre marque.

Signaux à utiliser : discussions sur les réseaux sociaux, articles, contenus d'influenceurs, tendances de recherche, données de ventes de la catégorie et sa croissance.

Fournir en plus :
1. Un ordre de grandeur du marché adressable (TAM) avec la source.
2. Une répartition estimée du TAM par niveau de conscience.
3. Une sélection FINALE du niveau où se situe la majorité du marché, avec le niveau de confiance.
```

## Prompt 2 — Recherche concurrents

```
Fais une recherche concurrentielle pour un produit dans l'espace {NICHE}. Le produit précis est {PRODUCT}, concurrents sur {GEOGRAPHY}. Nous cherchons spécifiquement : {COMPETITOR_TYPE}.

Pour chaque concurrent trouvé :
- À quelle cible s'adresse-t-il ?
- Quels sont ses principaux funnels d'acquisition ?
- Quel est son message central dans ses publicités, advertoriaux et autres assets ?
- Exemples de publicités ou de landing pages si disponibles.
- Hooks, angles ou grandes idées récurrents dans ses assets.
- Structure de prix.
- Ce que les clients aiment et n'aiment pas (avis, réseaux, forums).
- Si disponible, estimation du chiffre d'affaires global et du produit phare le plus proche du nôtre, avec la source.

Contexte additionnel : {DETAILS}.
```

## Prompt 3 — Recherche psychographique

```
Je rédige du copy de vente à destination de {AVATAR}. Fais une recherche psychographique : douleurs, croyances, désirs, en citant les prospects avec leurs propres mots (commentaires, forums, avis).

Insights démographiques :
- Qui est le client ? Attitudes (religieuses, politiques, sociales, économiques) ?
- Espoirs et rêves ? Victoires et échecs ?
- Quelles forces extérieures croit-il responsables de ne pas vivre sa meilleure vie ?
- Préjugés ? Résume ses croyances centrales sur la vie, l'amour, la famille en 1 à 3 phrases.

Solutions existantes :
- Que le marché utilise-t-il déjà ? Expérience vécue ?
- Ce qu'il aime, ce qu'il n'aime pas, histoires d'horreur ?
- Croit-il que les solutions existantes marchent ? Sinon pourquoi ?

Curiosité :
- Quelqu'un a-t-il tenté de résoudre ces douleurs de manière unique ? Résultat ?
- Y a-t-il un récit « conspirationniste » sur l'échec des anciennes solutions ?
- Tentatives anciennes (avant 1960) uniques ? Succès oublié ou échec, pourquoi ?

Corruption :
- Le marché croit-il que la douleur n'existait pas avant, ou était moins forte ?
- Croit-il qu'elle a été aggravée récemment par des forces extérieures ? Lesquelles et pourquoi ?
```
