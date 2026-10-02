---
name: meta-ads-copywriter
description: Rédige un pack de publicités Meta (Facebook, Instagram) pour un client — scripts face caméra de 30, 60 et 90 secondes en 3 angles distincts, plus les textes d'annonce (primary text en 3 longueurs, headline, description) — après un audit de l'offre. À utiliser pour "pubs Meta", "scripts pub face caméra", "ad copy", "3 variantes de pub" ; pas pour une VSL longue (vsl-copywriter) ni pour les visuels (creative-brief, creative-statics).
---

# Meta Ads Copywriter

Sortie : Markdown, français, multi-variantes. Copy uniquement (pas de storyboard), aucune vidéo produite.

## Phase 1 — Contexte

Lire dans l'ordre s'ils existent : `{CLIENT_DIR}/02b-offre/offre-reconstruite.md`, `00-onboarding/onboarding-form.md`, `01-deep-search/*.md`, `04-vsl/strategy.md` (hériter mécanisme, big idea, CTA), `03-campaign-proposal/proposition-campagne.md`.

Minimum requis, sinon demander en une salve : ICP (secteur + rôle + géo), offre (produit, prix, livraison), dream outcome, 3 douleurs (verbatim si possible), au moins une preuve avec sa source, cible du CTA (appel, audit, ressource, achat), formats (défaut 30 s + 60 s + 90 s, 3 variantes par durée). Optionnel : tutoiement ou vouvoiement, contraintes réglementaires, hooks déjà gagnants.

## Phase 2 — Audit de l'offre (obligatoire)

Scorer l'offre avec [references/offer-audit.md](references/offer-audit.md) (Value Equation sur 20, 6 piliers). 16 à 20 : continuer. 11 à 15 : proposer 2 à 3 corrections ciblées, faire valider. 10 ou moins : proposer une reconstruction dans `{CLIENT_DIR}/02b-offre/offre-reconstruite.md` avant toute pub. Ne pas écrire de pubs sur une offre faible ; l'utilisateur peut passer outre explicitement, le noter alors en tête du pack.

## Phase 3 — Avatar et angles

Bloc-notes interne : avatar (ICP, 3 douleurs, dream outcome, ennemi commun), stade de conscience, sophistication (coaching, conseil et agences en France : souvent 4 à 5, donc mécanisme nommé + spécificité).

Palette d'angles « Quoi / Qui / Quand » et archétypes dans [references/hooks-and-ctas.md](references/hooks-and-ctas.md). Sélectionner 3 angles distincts minimum ; chaque angle remonte à une douleur verbatim ou une preuve. Documenter en une ligne par angle pourquoi il existe.

## Phase 4 — Variantes

Format exact et comptages dans [references/ad-pack-format.md](references/ad-pack-format.md). Par durée demandée, 3 variantes avec un angle distinct chacune, structure Hook (0–3 s) / Body / CTA, puis copies Meta associées.

Règles : hook qui arrête le défilement en moins de 3 secondes ; pas de jargon avant le premier bénéfice ; français oral, phrases de 15 mots max ; verbatim de douleur en italique quand disponible ; mécanisme nommé si sophistication ≥ 3 (1 fois en 30 s, 2 à 3 fois en 60 s et plus) ; un seul CTA ; aucune hyperbole sans preuve ; conformité aux règles publicitaires Meta (pas d'allégation médicale, pas de garantie financière, pas de ciblage discriminatoire, pas d'avant/après corporel). Le respect effectif des politiques Meta reste à vérifier par l'utilisateur.

Jamais de variante sous 30 secondes.

## Phase 5 — Contrôle

Offre auditée · 3 variantes par durée, angles distincts · Hook + Body + CTA par variante · copies Meta complètes · un seul CTA · au moins une douleur ou preuve sourcée par variante · congruence script / copies / VSL / landing (même promesse, même mécanisme, même CTA) · comptage de mots affiché dans le titre de chaque script (≈ 155 mots/min : 78 pour 30 s, 156 pour 60 s, 233 pour 90 s) · comptage de caractères vérifié pour les copies · pas plus de 3 indications scéniques dans tout le pack · aucun chiffre inventé (placeholder `[PREUVE À FOURNIR]` sinon).

## Phase 6 — Sortie

`{CLIENT_DIR}/05-meta-ads/ads-multi-variantes.md` (+ `02b-offre/offre-reconstruite.md` si reconstruction). DOCX ou PDF via l'outil de conversion de l'utilisateur si demandé.

Message de fin : chemins, angles testés (1 ligne chacun), mécanisme, étape suivante (tournage des 60 s en priorité, test avec budget limité, itération sur le hook).
