---
name: creative-statics
description: Pipeline de production de créatives statiques Meta éditoriales (typographie sur fond, formats Feed 4:5, Story 9:16, carrousel 1:1) — brief visuel, copy tracée et validée en 6 points, builds itératifs, revue en conseil à 4 regards, curation et livraison — avec les outils de rendu configurés par l'utilisateur. À utiliser pour "créatives statiques {client}", "pack d'ads éditoriales", "lance le pipeline créa" ; pas pour le copy seul (meta-ads-copywriter) ni pour une créative ad hoc.
---

# Creative Statics

Le skill organise la production ; le rendu des images utilise l'outil que l'utilisateur a configuré (script PIL local, Figma, outil de génération d'images). Sans outil de rendu, livrer les spécifications de chaque créative (copy validée, layout, couleurs, tailles) : c'est un livrable utile, pas une image. Ne jamais affirmer qu'une image existe si elle n'a pas été produite.

## Entrées obligatoires

| Source | Fichier |
|---|---|
| onboarding | `{CLIENT_DIR}/00-onboarding/onboarding-form.md` (ICP, verbatims, prix, ton, interdits, assets) |
| deep-search | `{CLIENT_DIR}/01-deep-search/01..03-*.md` |
| competitor-ads-research | `{CLIENT_DIR}/02-competitor-ads/analysis.md` (white spaces, angles saturés, hooks) |
| meta-ads-copywriter | `{CLIENT_DIR}/05-meta-ads/ads-multi-variantes.md` |

Un livrable manquant → s'arrêter et demander de le produire.

## Phases

- **A. Brief visuel** (`creatives/brief-visuel.md`) : archétype couleur (confiance, urgence, énergie, autorité), couleur d'accent (marque ou proposée), 2 polices max, mécanisme nommé, CTA principal, formats prioritaires (défaut Feed 4:5 en majorité + Story 9:16 + 1 carrousel).
- **B. Copy par créative** : hook, sous-ligne, body, CTA, chacun tracé à une source `[V]` verbatim, `[W]` white space, `[P]` preuve sourcée, `[C]` croyance client, et validé par les 6 checks de [references/copy-validation-6-points.md](references/copy-validation-6-points.md). Sans annotation → réécrire ou supprimer.
- **C. Build v1** : 3 à 5 créatives typographiques pures sur les 3 angles les plus forts. Contrôle heuristique : dimensions exactes 1080×1080 / 1080×1350 / 1080×1920, poids raisonnable, CTA dans la zone sûre (≥ 14 % du bas), hook sur 3 lignes max.
- **D. Conseil v1** : 4 regards (garde de marque, recherche UX, design UI, copywriter) selon [references/council-review.md](references/council-review.md), en sous-agents parallèles si disponibles, sinon en 4 passes successives. Chaque regard note sur 10 et donne 3 corrections chiffrées. Ne pas builder v2 avant d'avoir lu les 4 verdicts, synthétisés dans `creatives/v2/_strategy.md`.
- **E. Build v2 et suivants** : corrections, nouveaux angles sur les white spaces, fonds générés si un outil d'image est configuré (avec estimation de coût annoncée avant tout lot facturé). Gate go / no-go entre versions : score conseil moyen en hausse, aucune violation de contraste, angles distincts.
- **F. Pool d'angles** (`creatives/angles_pool.json`) : 20 angles avec `id`, `name`, `category` (rareté réelle, histoire, preuve, cas client, autorité, manifeste, comparatif, transparence, ressource, avant/après, produit, ennemi commun, sceau de confiance), `hook`, `sub`, `body`, `cta`, `bg_theme`, `format`, `visual_strategy`. Sert aux itérations.
- **G. Curation et livraison** : sélectionner les meilleures (équilibre angles × formats), les autres dans `non-retenues/`, `README.md` d'index, `_strategy.md` de chaque version, copy source. Archive zip si demandé.

## Design system (verrouillé sauf charte client contraire)

Deux familles de polices maximum (une display serif pour les chiffres et hooks, une grotesque pour le reste) · un seul accent couleur = un seul point focal = le CTA · contraste hero ≥ 7:1, body ≥ 4.5:1, CTA ≥ 3:1 en grand texte · grille verticale : logo en haut, chip catégorie, hook ou chiffre hero, séparateur, sous-ligne, body et rail de stats, CTA centré en bas dans la zone sûre · 7 layouts : chiffre hero, hook italique 3 lignes, timeline horizontale, diptyque avant/après, comparatif 3 colonnes, carte stat, carrousel manifeste (3 à 4 slides). Détail dans [references/visual-quality-gate.md](references/visual-quality-gate.md).

## Ce qui reste manuel

Les verdicts du conseil, la rédaction de chaque `_strategy.md`, la curation finale, la réécriture des hooks signalés. Automatiser ces étapes produit de la médiocrité en boucle. Une itération planifiée (cron) n'est proposée que si l'utilisateur le demande et avec un plafond d'itérations et de coût qu'il fixe.
