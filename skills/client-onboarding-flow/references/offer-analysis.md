# Analyse et reconstruction d'offre (étape 2.5)

Workflow interne, sans dépendance externe. Entrées : `00-onboarding/onboarding-form.md` (offre, prix, différenciation, preuves), `01-deep-search/*.md` (stade de conscience, dream outcome, douleurs, verbatims), `02-competitor-ads/analysis.md` (claims du marché, angles saturés, white spaces).

## 1. Diagnostic — Value Equation

Valeur perçue = (Dream Outcome × Probabilité perçue) / (Délai × Effort et sacrifice).

Scorer chaque axe de 1 à 5 avec une justification d'une ligne. Une note de 5 est toujours favorable : résultat désirable et crédible, délai court, effort faible ; une note de 1 indique l'inverse. Ce score est une aide au diagnostic, pas une mesure scientifique de conversion :

| Axe | Question |
|---|---|
| Dream Outcome | Le résultat est-il précis, mesurable, désirable pour l'ICP ? |
| Probabilité perçue | Preuves, garantie, track record crédibles ? |
| Délai | Premier résultat tangible en combien de temps ? |
| Effort et sacrifice | Ce que le client doit faire, risquer, abandonner ? |

Total sur 20 : 16 à 20 solide, 11 à 15 moyenne (2 à 3 corrections ciblées), 10 ou moins faible (reconstruction complète).

Vérifier aussi les 6 piliers de la décision d'achat : motivation profonde, objectif, problème, douleur, action attendue, confiance. Noter le pilier faible.

## 2. Calibrage marché

- **Stade de conscience** (1 à 5, rapport market awareness) : décide l'entrée en matière (problème, comparaison, mécanisme, offre directe).
- **Sophistication** (1 à 5, rapport concurrents) : niveau 1 à 2 → promesse directe ; 3 → mécanisme nommé ; 4 → niche ou comparaison directe ; 5 → identité, histoire, spécificité radicale.
- **Angles saturés** : tout claim présent chez la majorité des concurrents est exclu de la promesse principale.
- **White spaces** : les angles non exploités deviennent candidats pour la promesse ou une variation.

## 3. Reconstruction

Écrire `02b-offre/offre-reconstruite.md` :

```markdown
# Offre reconstruite — {client}

## Promesse
[Résultat] en [délai] sans [douleur principale], même si [objection principale].

## Mécanisme nommé
Nom + 3 raisons pour lesquelles il fonctionne (le pourquoi, pas le comment détaillé).

## Stack de valeur
| Élément | Problème résolu | Valeur attribuée (base explicite) |
Chaque valeur attribuée est justifiée (prix marché, temps économisé, alternative). Pas de chiffres décoratifs.

## Garantie / renversement du risque
Type (résultat conditionnel, satisfait ou remboursé, pay on results, aucune) et conditions.

## Prix et modèle
Prix, ancrage, paiement. Le prix reste celui du client sauf si le diagnostic recommande explicitement un changement (avec le raisonnement).

## Rareté et urgence honnêtes
Seulement si réelles (capacité, calendrier). Sinon écrire "aucune".

## Pour qui / pas pour qui

## 3 variations d'angle testables
Angle, promesse reformulée, preuve mobilisée.
```

Écrire `02b-offre/offre-diagnostic.md` : scores avant/après, pilier faible, hypothèses, ce qui manque (preuves à produire, garantie à valider juridiquement par le client).

## 4. Honnêteté

Si la recherche montre un marché sans douleur forte ou sans capacité de paiement, ou une offre de commodité à faible marge, le dire dans le diagnostic et proposer un positionnement réaliste plutôt qu'un habillage premium. Toute garantie ou promesse chiffrée reste une proposition à valider par le client ; le skill ne certifie ni conformité ni résultat.
