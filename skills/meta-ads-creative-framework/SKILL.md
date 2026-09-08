---
name: meta-ads-creative-framework
description: Définit les spécifications visuelles de créatives Meta à réaliser dans Figma ou tout outil de design — direction artistique par archétype, layouts par format (Feed, Story/Reel, carrousel), hiérarchie typographique, couleurs, boutons CTA, specs d'export et checklist de composants — en complément du copy. À utiliser pour "specs visuelles pubs", "template Figma ads", "direction artistique Meta" ; pas pour le copy (meta-ads-copywriter) ni pour générer les images (creative-statics).
---

# Meta Ads Creative Framework

Sortie : `{CLIENT_DIR}/05-meta-ads/creative-specs.md` (Markdown uniquement). Le designer assemble ensuite les créatives dans son outil.

## Phase 1 — Brief visuel

Lire `{CLIENT_DIR}/05-meta-ads/creative-brief.md` s'il existe, sinon demander : client et contexte · archétype couleur (urgence, confiance, énergie, autorité) · formats et nombre de variantes · assets disponibles (logo, photos, captures, témoignages) · ton visuel (UGC brut, corporate propre, bold, premium épuré). Optionnel : contraintes de marque, références admirées, copy validé (`ads-multi-variantes.md`) dont on reprend hooks et CTA.

## Phase 2 — Direction artistique (à valider avant les specs)

| Archétype | Palette | Typo texte | Typo impact | Layout dominant |
|---|---|---|---|---|
| Urgence / performance | sombre + rouge ou orange | sans-serif neutre | condensée forte | plein cadre + carte flottante |
| Confiance / premium | clair + bleu ou navy | sans-serif géométrique | serif display | split 50/50 |
| Énergie / transformation | sombre + orange ou jaune | sans-serif ronde | condensée | image hero + texte en surimpression |
| Autorité / données | gris clair + indigo ou bleu | sans-serif neutre | condensée | image hero + surimpressions chiffrées |

Documenter palette exacte (hex), 2 polices, layout principal, en un bloc court pour validation.

## Phase 3 — Specs par format

Pour chaque format demandé : layout annoté (zones hero, texte, CTA, logo avec dimensions en px), tailles typographiques par niveau, couleurs exactes (fond, texte, CTA, accents), CTA (type, dimensions, placement), export. Détails dans [references/format-specs.md](references/format-specs.md) et [references/design-system.md](references/design-system.md).

Carrousel : progression narrative (slide 1 hook visuel, slides intermédiaires douleur → mécanisme → preuve → bénéfice, dernière slide CTA + rappel de l'offre) et éléments de continuité (palette, grille, élément traversant).

Terminer par la liste des composants à créer dans l'outil de design (styles couleur, styles texte, bouton CTA en variantes, cartes, badge logo, frames par format, nommage `{client}-{format}-v{n}-{variante}-{date}`).

## Phase 4 — Contrôle

Zones sûres respectées · contraste AA (4.5:1 texte, 3:1 grand texte) · CTA visible, cible ≥ 44 px · 2 familles de polices max · lisible en aperçu 375 px · export au bon ratio et résolution, sRGB, sans transparence · congruence avec la landing (palette, typo, ambiance) · texte sur image limité (bonne pratique ≈ 20 %) · aucune allégation visuelle interdite (avant/après santé, résultats financiers garantis).

## Règles

Ce skill produit des specs, pas du copy · valider la direction artistique avant les specs détaillées · mobile d'abord · Markdown seulement.
