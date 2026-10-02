---
name: sales-call-analyzer
description: Transforme la transcription d'un appel de vente en brief commercial structuré (JSON + Markdown) — état rêvé et objections en verbatim, vocabulaire du métier, faits société, économie, délai de décision, expérience avec des prestataires précédents — prêt à alimenter une proposition commerciale. À utiliser pour "analyse l'appel de vente", "brief commercial depuis l'appel", "prépare le devis depuis la transcription" ; pas pour rédiger la proposition (devis-vercel-generator).
---

# Sales Call Analyzer

Règle d'or : **verbatim plutôt que paraphrase**. Les mots exacts du prospect nourrissent le titre et les puces de la proposition.

## Entrées

Transcription (`.txt`, `.md`, `.vtt`, `.srt` ou texte collé), nom du client, optionnellement l'URL de son site pour l'enrichissement. Sans transcription → demander.

## Extraction ([references/extraction-guide.md](references/extraction-guide.md))

1. Rêve et objections : scanner 4 types de phrases (douleur exprimée, désir exprimé, contre-exemple, objection sur l'offre) et citer exactement.
2. Voix du client : le mot du métier pour « affaire » (chantier, patient, dossier, mandat, commande, contrat…), pour « client », pour « rendez-vous » ; ICP ; sensibilité au prix ; stade d'achat.
3. Faits : raison sociale, adresse, dirigeant, téléphone, email, secteur, géographie, panier moyen, équipe commerciale, volume, délai de décision, budget, concurrents, expérience avec des prestataires.
4. Enrichissement conditionnel : si email, raison sociale, adresse, année de création ou preuve sociale manquent, lire le site du prospect avec l'outil de fetch disponible (`/mentions-legales`, `/contact`, `/a-propos`, accueil). Sans outil → laisser vide et lister dans `needs_human_review`.

## Sortie

`{CLIENT_DIR}/10-sales/brief-appel.json` (schéma [references/brief-schema.json](references/brief-schema.json)) et `brief-appel.md` lisible (mêmes sections, verbatims entre guillemets).

## Gates avant livraison

- Contact et société remplis ou listés dans `needs_human_review`.
- `dream_state.headline_hook` au rythme « X. Y. Sans Z. », ≤ 12 mots.
- `objections.headline_subtitle_bullets` : exactement 3 puces commençant par « Fini les », chacune issue d'une douleur verbatim.
- `industry_vocab.deal_word` jamais « deal » si le prospect a utilisé un autre mot ; défaut « client ».
- ≥ 3 verbatims de douleur et ≥ 2 verbatims de victoire.
- `prior_provider_pain` rempli seulement si un prestataire précédent a été mentionné, sinon `null`.
- `avg_basket_eur` cohérent avec le secteur (coaching et formation quelques centaines à quelques milliers d'euros ; bâtiment plusieurs milliers ; logiciel entreprise dizaines de milliers) ; hors plage → flag.

Aucune information absente de la transcription ou du site ; pas de vocabulaire corporate (« synergie », « accompagnement », « valeur ajoutée »).

## Message de fin

Chemins, titre extrait, 3 « Fini les », mot du métier, panier moyen, délai de décision, budget confirmé, gates passés sur 7, étape suivante (`devis-vercel-generator`).
