---
name: creative-statics-v2
description: Génère un pack de créatives statiques Meta photoréalistes ou natives (texte incrusté rendu par un modèle d'image) via une matrice de variations angles × formats × styles, une art-direction dérivée du profil de marque et de l'inspiration concurrentielle, une revue à 5 regards et une passe optionnelle de verrouillage de marque — avec le moteur d'image configuré par l'utilisateur. À utiliser pour "créatives V2", "variations créatives", "pack ads photo", "inspire-toi des ads concurrentes" ; pour des créatives typographiques pures, préférer creative-statics.
---

# Creative Statics V2

V1 (`creative-statics`) dessine la typographie sur des fonds ; V2 fait rendre la créative complète par un modèle d'image dirigé par une art-direction. Un bon pack mélange les deux.

| Situation | Choix |
|---|---|
| photoréalisme, lifestyle, produit en contexte, humain, forte diversité visuelle, marque forte | V2 |
| typographie pure, chiffre hero, contraste garanti, polices exactes, reproductibilité | V1 (ou V2 + passe brand-lock) |

## Moteur d'image

Le skill n'impose aucun fournisseur. Utiliser le moteur que l'utilisateur a configuré (CLI ou API d'un service de génération, modèle local). Utiliser le modèle, les formats et le budget déjà autorisés. Si un coût ou un choix nécessaire sort de ce périmètre, le préciser et obtenir cet accord avant de l’engager. Sur un nouveau dispositif, vérifier une image test avant le lot ; une validation utilisateur supplémentaire n’est nécessaire que si elle est prévue par la mission ou si le résultat change le périmètre. Certains modèles ne proposent pas le 4:5 natif. Respecter la limite de jobs simultanés du compte (pool de workers, pas de rafale). Si la génération semble échouer côté client, vérifier la liste des jobs avant de relancer : un job facturé peut avoir réussi. Aucun secret n'est demandé ni affiché dans la conversation ; les clés vivent dans l'environnement de l'utilisateur.

Sans moteur disponible : livrer la matrice et les prompts d'art-direction, et le dire.

## Entrées

Les 4 livrables de V1 (onboarding, deep-search, `02-competitor-ads/data.csv` + `analysis.md`, copy pack) + `client-brand-profile.json` construit en phase A.

## Phases

- **A. Profil de marque** (`05-meta-ads/client-brand-profile.json`). D'abord lire le site officiel du client avec l'outil de fetch disponible : palette réelle (hex dans le CSS), polices chargées, ton (hooks, taglines), style dominant, logo. Jamais de valeurs par défaut inventées quand le site existe. Champs : `palette` (3 à 5 hex avec rôles), `fonts`, `logo` (chemin + zone), `tone`, `do`, `dont`, `brand_assets` (produit, fondateur, ambiance), `render` (modèle, résolution, mapping des ratios), `accent_archetype`. Cas rebrand : chercher le nouveau site, ne jamais mentionner l'ancien nom ; vérifier en fin de run par une recherche du terme dans le dossier de livraison.
- **B. Inspiration concurrentielle** : depuis `data.csv`, angles les plus fréquents et leurs hooks, angles saturés (présents chez plusieurs concurrents), white spaces (croisés avec `analysis.md`), 2 à 3 ads durables comme **références de style uniquement**. Le copy reste 100 % client.
- **C. Matrice de variations** (`variation-matrix.json`, [references/variation-matrix.md](references/variation-matrix.md)) : 6 à 8 angles, 3 formats (Feed 4:5 ≈ 60 %, Story 9:16 ≈ 25 %, 1:1 ≈ 15 %), 2 à 3 styles par angle, 8 à 12 concepts natifs distincts de [references/native-concept-formats.md](references/native-concept-formats.md), une seule variable de test par cellule.
- **D. Copy par cellule** : 6 checks et traçabilité `[V][W][P][C]` (référence de V1). CTA en majuscules, aligné dans la colonne du headline.
- **E. Art-direction** : un prompt par cellule d'après [references/art-direction-prompt.md](references/art-direction-prompt.md). Composition bord à bord, aucune bande blanche ; logo et CTA en surimpression sur la scène.
- **F. Test** : 1 image, lecture, contrôle fidélité marque et lisibilité du texte ; vérifier le respect du budget et du circuit de validation convenus.
- **G. Lot** : génération cellule par cellule avec pool, try/except par cellule, journal append-only. La clé du cache inclut prompt, fournisseur/modèle et version, paramètres, ratio/résolution et hash des images de référence ; réutiliser seulement un résultat existant correspondant exactement à cette clé. Le cache limite les doublons mais ne garantit pas l'absence de facturation fournisseur. Sortie dans `creatives-v2/raw/`.
- **H. Conseil à 5 regards** (référence `council-review.md` de V1 + fidélité du rendu IA), synthèse `_strategy-v2.md`, régénération des cellules signalées (le prompt est souvent bon, le texte IA est aléatoire).
- **I. Verrouillage et livraison** : passe optionnelle de ré-incrustation exacte du logo, du CTA et des mentions (outil de composition local) quand le texte rendu n'est pas net ; contrôle dimensions, poids, contraste, zone sûre ; curation (≈ 15 retenues sur ≈ 20 générées, reste dans `non-retenues/`, défauts non régénérables dans `a-regenerer/`) ; `README.md` + matrice + copy + insights concurrents.

## Reste manuel

Verdicts du conseil, `_strategy-v2.md`, curation, jugement sur la fidélité, approbation du coût.
