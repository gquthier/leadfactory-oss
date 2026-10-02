---
name: data-scraping
description: Construit une base de prospection B2B qualifiée à partir de données publiques et légales — en priorité l'open data SIRENE française (API Recherche Entreprises, sans clé) — avec scoring ICP, dédoublonnage par SIREN, export CSV/XLSX, rapport QA, puis enrichissement email au moindre coût. À utiliser pour "sourcer des prospects", "trouver des entreprises par NAF/département", "enrichir des emails", "construire une base adressable" ; pas pour envoyer l'outreach (outbound-sequence-writer) ni pour les créatives concurrentes (competitor-ads-research).
---

# Data Scraping — moteur de sourcing B2B

## Principes

1. **Données réelles ou rien.** Aucune ligne (SIREN, dirigeant, âge) n'est inventée par le modèle. Pas de source réelle → le dire et s'arrêter.
2. **Gratuit et légal d'abord** : registres publics (SIRENE, INPI, BODACC, annonces légales) avant tout service payant.
3. **La boucle d'extraction est du code déterministe** (fetch + scoring + dédoublonnage), pas des appels de modèle. « 50 lots » = 50 combinaisons secteur × département itérées par le code.
4. **Le modèle juge, il ne boucle pas** : concevoir les modules, corriger les heuristiques sur des lignes réelles, valider un échantillon contre une source officielle.
5. **Pilote avant échelle** : un lot, lecture des lignes, correction, validation externe, puis montée en charge.
6. **Sourcing ≠ outreach.** Aucun message envoyé ici.

## Entrées

- ICP : secteur(s) avec codes NAF, géographie (départements), taille (tranches d'effectif), critères de qualification (ancienneté, structure, signaux).
- Objectif de volume et seuil de score.
- Dossier de sortie : `{CLIENT_DIR}/data/` (à exclure du versionnement : données personnelles de dirigeants).

## Méthode 1 — Sourcing (stack française gratuite)

Détail de l'API, paramètres, pièges et codes dans [references/sirene-api.md](references/sirene-api.md).

0. **Sonder la source à la main** avant toute architecture : un appel `curl` sur l'API avec le NAF et un département ; vérifier les champs exposés, `per_page` maximum (25), pagination, total.
1. **Contrat de types** écrit d'abord (entreprise, lot, source, résultat de score, ligne d'export), avec la table NAF et le mapping effectif comme source unique.
2. **Modules** : source SIRENE, scoring, table des groupes/consolidateurs, export CSV. Orchestrateur, lots et export XLSX gardés ensemble pour la cohérence.
3. **Orchestrateur** : lots secteur × département, `Set` partagé dédoublonnant par SIREN, pool de concurrence faible (≈4), écriture CSV atomique, deux seaux : `*_chauds.csv` (score ≥ seuil) et `*_froids.csv`.
4. **Pilote (obligatoire)** : un lot, ouvrir le CSV, lire les lignes, interroger le seau froid. Deux pièges typiques : dirigeant avec `qualite: null` ignoré alors qu'il est le seul dirigeant physique d'une petite structure (repli sur la première personne physique quand peu d'établissements) ; `annee_de_naissance` absente sur une large part des lignes (proxy prudent via `date_creation`, seulement quand l'âge réel manque, jamais cumulé).
5. **Validation externe** : vérifier un échantillon (5 confirmations minimum) contre un registre officiel du secteur ou une recherche web d'existence. Dire quel niveau de validation a été atteint.
6. **Funnel acheteurs** (optionnel) : mêmes données, filtre inverse ; une entreprise est un groupe si nom connu, catégorie ETI/GE, ou nombre d'établissements élevé (seuil à régler en regardant les données, un seuil trop bas attrape des PME multi-sites).
7. **Export et QA** : XLSX multi-onglets (chauds / froids / acheteurs / synthèse), dédoublonnage défensif, `QA-RAPPORT.md` : distribution des scores, complétude des champs (SIRENE ne donne aucun email ; l'année de naissance est souvent absente), intégrité (0 doublon, 0 SIREN manquant, 0 acheteur dans les vendeurs), répartition géographique.

## Méthode 2 — Enrichissement email (nom → domaine → email)

Détail dans [references/email-enrichment-fr.md](references/email-enrichment-fr.md). Pipeline : désambiguïsation par l'API SIRENE (ville, code postal, dirigeant) → résolution du domaine via un moteur de recherche disponible (instance SearXNG, ddgs, ou API payante si l'utilisateur en a une) → scoring du domaine (jamais la première URL, liste noire des annuaires, vérification du nom et de la ville dans le titre) → extraction sur home, `/contact`, `/mentions-legales` → nettoyage (placeholders, emails de templates) → repli curl puis navigateur uniquement sur sites protégés.

Être honnête sur les taux : une part importante des PME françaises n'a pas de site ; tout outil annonçant 100 % produit des faux positifs.

## Garde-fous RGPD

Registres publics uniquement, pas de scraping d'emails personnels, aucun contact envoyé. L'adresse la plus défendable est celle affichée dans les mentions légales. Livrer la base à l'utilisateur dans son dossier ; ne jamais afficher de jeton ou secret dans la conversation.

## Quand ne pas l'utiliser

Envoi d'outreach ; données non structurées comme un registre (créatives publicitaires) ; scrape ponctuel d'un site sans qualification (écrire le script directement).
