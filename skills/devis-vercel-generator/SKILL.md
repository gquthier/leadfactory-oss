---
name: devis-vercel-generator
description: Génère une proposition commerciale personnalisée et éditable (Markdown + JSON, avec option de page HTML et PDF) à partir du brief d'appel de vente — titre rêve/objection, parties, livrables, preuves fournies, simulateur avec calculs explicites, détail chiffré, étapes, conditions, appel à l'action — et, seulement sur demande, la déploie avec la CLI d'hébergement configurée par l'utilisateur. À utiliser pour "génère le devis", "page de proposition commerciale {client}" ; pas pour analyser l'appel (sales-call-analyzer).
---

# Devis / Proposition commerciale

Le livrable est une **proposition commerciale éditable**, pas un contrat : les montants, conditions et garanties sont ceux fournis par l'utilisateur, les calculs sont montrés, et le document indique qu'il doit être relu et validé par l'émetteur avant envoi. Le skill ne certifie ni conformité juridique ni résultat.

## Entrées

`{CLIENT_DIR}/10-sales/brief-appel.json` (schéma de `sales-call-analyzer`) · paramètres de l'émetteur (`agency-profile.json` ou fournis) : nom légal, représentant, email, adresse, logo, couleurs, tagline, offre standard (lignes du devis avec prix), preuves réelles (chiffres avec source, note d'avis), lien de paiement s'il existe, durée de validité. Champ critique manquant → demander ou laisser `[À COMPLÉTER]` visible ; ne jamais inventer un montant, une preuve ou une partie.

## Sorties

```
{CLIENT_DIR}/11-devis/
├── proposition.md        document éditable, 12 sections
├── proposition.json      données (parties, lignes, calculs, vocabulaire, validité)
└── page/index.html       optionnel : page HTML autonome + bouton PDF (voir références)
```

Structure et calculs : [references/proposal-structure.md](references/proposal-structure.md). Vocabulaire métier : [references/industry-vocab.md](references/industry-vocab.md). Page HTML et PDF : [references/html-pdf-notes.md](references/html-pdf-notes.md).

## Pipeline

1. Lire le brief ; vérifier les champs critiques (nom, société, contact, titre rêve/objection, 3 puces « Fini les », vocabulaire, panier moyen, délai de décision).
2. Remplir les 12 sections avec le vocabulaire du métier (`deal_word`, `customer_word`, `meeting_word`) partout où le mot « affaire », « client » ou « rendez-vous » apparaît.
3. Référence `{PREFIXE}-{AAAAMMJJ}-{seq}` (préfixe choisi par l'émetteur ; seq = nombre de propositions existantes + 1).
4. Simulateur : montrer la formule et les valeurs par défaut (panier moyen du brief, budget média, coût par lead hypothétique, taux de conversion hypothétiques) ; étiqueter « hypothèses modifiables », pas de résultat promis.
5. Page HTML si demandée : design sobre au choix de l'émetteur, calculateur interactif, bouton PDF réel (pas `window.print()`), lien de paiement dans le corps du PDF.
6. Contrôle : 12 sections dans l'ordre · aucun placeholder oublié sauf ceux volontairement visibles `[À COMPLÉTER]` · total = somme des lignes · validité cohérente (titre, conditions, pied) · vocabulaire appliqué partout · preuves uniquement réelles et sourcées · émetteur uniquement dans la section « parties » et le pied.
7. Déploiement : seulement si demandé et si la CLI (Vercel, Netlify…) est authentifiée ; sinon fournir la commande. Prévisualisation locale avec `python3 -m http.server`. Tester réellement le téléchargement PDF avant de livrer une URL.

Style : phrases courtes, affirmations directes, aucune tournure de remplissage, pas d'emoji dans les titres.
