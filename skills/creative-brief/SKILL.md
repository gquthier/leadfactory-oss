---
name: creative-brief
description: Produit le brief créatif structuré remis au designer ou creative strategist — identité de marque, audience, paysage concurrentiel, 10 templates créatifs avec angle, headline et puces, direction copy, style visuel, références — à partir du dossier client et d'une campagne, en Markdown et JSON. À utiliser pour "brief créatif", "brief designer", "brief Figma {client}" ; pas pour écrire les pubs (meta-ads-copywriter) ni produire les visuels (creative-statics).
---

# Creative Brief

Fonctionne à partir d'un **dossier client et d'une campagne**, sans base de données. Sortie : `{CLIENT_DIR}/05-meta-ads/creative-brief.md` et `creative-brief.json` (format dans [references/brief-format.md](references/brief-format.md)). Le JSON est prévu pour être collé dans un outil de gestion ou un onglet « Brief créatif » ; l'import est fait par l'utilisateur.

## Entrées

Lire ce qui existe, continuer avec ce qui est disponible :

- `{CLIENT_DIR}/00-onboarding/onboarding-form.md` ou export cockpit (entreprise, offre, audience, objectif, budget, notes) — ou texte collé.
- `{CLIENT_DIR}/01-deep-search/*.md` (persona, douleurs, désirs, objections, langage).
- `{CLIENT_DIR}/02-competitor-ads/analysis.md` (styles visuels, angles, white spaces).
- `{CLIENT_DIR}/03-campaign-proposal/proposition-campagne.md` (angles retenus, formats).
- Campagne concernée : nom, canal, objectif, budget (demander si plusieurs campagnes).
- Assets de marque : URL du site, logo, couleurs, polices, charte, liens de dossier.

Manque critique (nom du client, offre) → demander. Ne pas remplir avec du générique : tout ce qui n'est pas connu est écrit `À fournir : …` dans une section « Informations manquantes ».

## Les 7 sections + 10 templates

1. **Identité de marque** : nom, logo, site, couleurs (hex), polices, charte existante, ton.
2. **Audience** : persona (démographie + psychographie), douleurs, désirs, objections, déclencheurs, langage de la cible (verbatims), insights de recherche.
3. **Paysage concurrentiel** : concurrents et positionnement, styles visuels observés, angles utilisés, opportunités de différenciation.
4. **Templates créatifs (10 minimum)**, chacun avec un angle distinct parmi : douleur, désir, preuve sociale, contre-intuitif, urgence, autorité, comparaison, témoignage, éducatif, transformation. Par template : nom, format (1080×1080, 1080×1350, carrousel), angle, headline (≤ 8 mots), sous-headline (≤ 15 mots), 3 à 4 puces à poser sur le visuel, direction de style.
5. **Direction copy** : ton (tu/vous, registre), framework (promesse → preuves → CTA), messages clés, formulations à éviter, exemple bon / mauvais.
6. **Style visuel** : palette recommandée, typographie, type d'imagerie (photo, illustration, 3D, flat), ambiance, mise en page, références.
7. **Références et documents** : liens vers toutes les sources et assets disponibles.

## Règles

- Français, ton direct, données spécifiques au client.
- Headlines courtes ; aucune preuve ni chiffre inventé (placeholder si absent).
- Emojis : uniquement si l'utilisateur ou son outil les demande ; par défaut aucun.
- Le Markdown est lisible tel quel ; le JSON reprend les mêmes contenus (HTML simple autorisé dans les champs `*Html` : `p`, `h3`, `strong`, `em`, `ul`, `li`, `a`, sans style ni classes).

## Contrôle

7 sections remplies · 10 templates à angles distincts, chacun complet · section références complète · section « Informations manquantes » présente si nécessaire · JSON valide.
