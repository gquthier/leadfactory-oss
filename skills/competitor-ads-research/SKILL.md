---
name: competitor-ads-research
description: Analyse les publicités Meta (Facebook, Instagram) des concurrents d'un client via la Meta Ads Library ou un outil d'extraction configuré par l'utilisateur, classe chaque ad en 5 angles, repère les ads qui tournent depuis longtemps, extrait hooks, CTA, angles saturés et white spaces, et livre un brief Markdown + CSV. À utiliser pour "analyse les pubs des concurrents", "ad library {marque}", "veille concurrentielle Meta" ; pas pour écrire des pubs (meta-ads-copywriter) ni pour la recherche marché (deep-search).
---

# Competitor Ads Research

Structure inspirée du skill open source « competitive-ads-extractor » (ComposioHQ, awesome-claude-skills) et adaptée au process 5 angles.

## Entrées

- Nom du client, marché, **liste de 3 à 10 concurrents** (noms de pages Facebook ou URLs Ads Library), géographie, profondeur (Quick 10 ads, Standard 25, Deep 50+ par concurrent), période (actives / 30 j / 90 j).
- Sortie : `{CLIENT_DIR}/02-competitor-ads/`.

Info manquante → demander avant de lancer.

## Sources de données, par ordre de préférence

1. **Outil d'extraction configuré par l'utilisateur** (serveur MCP Ads Library, API tierce, scraper maison). L'utiliser tel qu'il est exposé ; ne jamais demander une clé API en clair dans la conversation.
2. **Meta Ads Library en accès web** (`facebook.com/ads/library`) via l'outil de navigation ou de fetch disponible : lecture des textes, dates, formats ; captures uniquement si l'outil le permet.
3. **URLs fournies par l'utilisateur** pour chaque ad.

Sans aucune de ces options : s'arrêter et le dire. Mode 2 ou 3 = **mode dégradé** à signaler dans le livrable (pas de téléchargement des médias, analyse visuelle limitée).

## Pipeline

1. **Résolution** : pour chaque concurrent, identifier la page. Ambiguïté → confirmer avec l'utilisateur.
2. **Extraction** : pour chaque ad, récupérer id, texte primaire, headline, description, CTA, format, dates de début et dernière observation, pays, plateformes, URL de destination, média si possible.
3. **Classification** : un angle unique par ad parmi Douleur / Désir / Preuve / Contre-intuitif / Urgence, selon [references/angles-winners-patterns.md](references/angles-winners-patterns.md). Hook = 3 premières secondes ou première phrase, verbatim.
4. **Ads durables** : `days_active > 21` → `winner`, `> 60` → `hero`, `> 180` → `evergreen`. La durée est un proxy de performance, pas une mesure ; le dire dans le brief.
5. **Patterns** : structures de hooks récurrentes, frameworks de copy, format dominant par angle, CTA fréquents, douleurs partagées (angle saturé si présent chez 4 concurrents ou plus), white spaces (douleurs du marché absentes des ads concurrentes, croisées avec la deep search si disponible).
6. **Livrables** :

```
{CLIENT_DIR}/02-competitor-ads/
├── data.csv          une ligne par ad, schéma dans references/csv-schema.md
├── analysis.md       insights détaillés (source du brief)
├── brief-concurrents.md   livrable client, structure ci-dessous
└── creatives/        médias téléchargés, seulement si l'outil le permet
```

## Structure de `brief-concurrents.md`

1. Brief stratégique : 4 à 7 phrases (marché, concurrents, nombre d'ads, période, mode d'analyse).
2. Vue d'ensemble : volumes par concurrent, distribution par angle, par format.
3. Patterns gagnants : 3 à 5, avec nombre de concurrents, 1 à 2 verbatims d'ads durables, pourquoi ça marche en une phrase.
4. Angles saturés vs white spaces.
5. Top hooks : 8 à 12 verbatims, extraits des ads durables uniquement.
6. Top CTA : 5 à 8.
7. Recommandations : 3 à 5 maximum, affirmatives (« Tester l'angle X en format Y avec le hook Z »).
8. Annexe : tableau concurrent / ad id / angle / hook / jours actifs / durable.

## Qualité avant livraison

- Chaque concurrent résolu ; au moins 80 % de la profondeur demandée extraite, sinon expliquer l'écart.
- Chaque ad a un angle unique, aucune catégorie « autre ».
- Au moins 3 patterns et 1 white space identifiés.
- Brief en français, phrases courtes, aucune tournure de remplissage, pas plus de 5 recommandations.
- Jamais recommander de copier une ad verbatim : s'inspirer, transformer, dépasser.
- Mode dégradé clairement mentionné en tête du brief.

## Document client

Si un DOCX ou PDF est demandé, convertir `brief-concurrents.md` avec l'outil disponible sur la machine (pandoc, LibreOffice, skill docx). Le Markdown reste le livrable de référence.
