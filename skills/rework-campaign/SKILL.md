---
name: rework-campaign
description: Audite un compte Meta Ads qui tourne, score chaque annonce sur des métriques réelles (CPL, hook rate, hold rate, CTR, CVR, fréquence) avec des gates de volume et de tracking, propose ou applique des actions réversibles (pause, ajustement borné de budget), et prépare des variations des gagnants. À utiliser pour "audite le compte Ads", "coupe les créas qui ne marchent pas", "scale les gagnants", "rework campaign" ; pas pour créer une campagne de zéro (meta-campaign-launcher).
---

# Rework Campaign

Boucle : audit (insights réels) → score (KILL / KEEP / SCALE / ITERATE) → actions réversibles → variations des gagnants → réintégration en pause → re-mesure.

Mode par défaut : **proposition** (calcule, écrit le rapport, n'exécute rien). Exécution seulement si l'utilisateur a fixé un mandat écrit (CPL cible, budget plancher et plafond, fenêtre d'attribution, ad sets éligibles) et demande explicitement `--execute`. Toute action est réversible (pause, jamais suppression) et bornée.

## Phases

- **A. Santé du compte** (bloquant) : jeton depuis l'environnement (jamais demandé en clair), `account_status = 1`. Coupe-circuit global : dépense +25 % jour sur jour, CPA compte +30 % en 24 h, ou 0 conversion sur 24 h avec du volume → lecture seule + alerte. Gate tracking : aucun événement depuis 6 à 24 h, volume −40 % vs médiane 7 j → geler kill et scale. Un tracking cassé fabrique des `leads = 0` qui tueraient des gagnants.
- **B. Insights** : `/act_{id}/insights?level=ad` sur 3, 7 et 14 jours, champs et parsing dans [references/decision-and-metrics.md](references/decision-and-metrics.md) ; relier chaque ad à sa créative (2 appels).
- **C. Score** : appliquer les gates (tracking, maturité hors apprentissage, volume, fenêtre d'attribution écoulée, confiance ≥ 90 %) puis le framework ; un gate échoué → `INSUFFICIENT_DATA`, action `wait`. Sortie : verdict, raison, confiance par ad.
- **D. Actions bornées** : pause des KILL confirmés ; budget des SCALE augmenté selon la limite sans réinitialisation exposée par Meta pour l'ad set (repli +15 à 20 %), max 1 hausse / 72 h ; par run max 2 kills ou 15 % des ads actives (le plus petit), max 20 % du budget déplacé ; jamais d'édition qui réinitialise l'apprentissage d'un gagnant : dupliquer.
- **E. Variations** : pour chaque ITERATE et gagnant à diversifier, brief pour `creative-statics-v2` : décomposer le gagnant en `[visuel] + [hook] + [angle] + [CTA]`, garder 3 constants, changer 1. Hiérarchie : angle > hook > preuve > format > CTA. 7 angles de service B2B : douleur, preuve, mécanisme, contrarien, temps/effort, prix/ROI, autorité. 3 à 5 variations par round, une variable par cellule.
- **F. Réintégration** : upload et création des ads en PAUSED dans un ad set de test propre (via `meta-campaign-launcher`), puis re-mesure au run suivant.

## Diagnostic central CTR × CVR

CTR bas + CVR ok → créative ou hook (régénérer) · CTR ok + CVR bas → offre, landing, cohérence message (ne pas toucher la créative) · les deux bas → prioriser la créative · les deux ok → SCALE. Ordre d'audit du funnel, s'arrêter au premier maillon cassé : tracking → volume → hook → hold → CTR → CPC → CVR → CPL.

## Sortie

`{CLIENT_DIR}/08-rework/rapport-{date}.md` : santé du compte, tableau par ad (métriques, verdict, raison, confiance), actions proposées ou exécutées avec horodatage, variations à produire, décisions humaines attendues (zone grise CPA 1,1 à 1,5× cible, flags). Les seuils sont des défauts à surcharger par le mandat ; aucune promesse de résultat.

## Garde-fous

Fail-safe : doute ou donnée manquante → inaction + alerte · mode proposition tant qu'aucun mandat n'est validé · jamais d'action budgétaire sur un ad set en apprentissage, ni dans les 5 à 7 jours après un lancement ou une édition · CPA et CVR jugés sur une fenêtre ≥ attribution (7 jours), jamais le jour courant · pause, jamais suppression, tout journalisé, retour arrière possible.
