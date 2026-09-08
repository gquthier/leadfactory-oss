---
name: vsl-copywriter
description: Écrit le script d'une Video Sales Letter (VSL) et son document de stratégie à partir des rapports de recherche d'un client (conscience du marché, concurrents, psychographie) et de son offre, en deux modes — coach/DTC 8 à 12 min en 16 blocs, ou B2B 3 à 5 min en 8 blocs. À utiliser pour "script VSL", "écris la VSL", "vidéo de vente" ; pas pour des pubs courtes (meta-ads-copywriter) ni pour la production vidéo elle-même.
---

# VSL Copywriter

Livrable : un **script** (texte de voix off, texte à l'écran, indications) et une **stratégie**. Aucune vidéo n'est produite ici ; le rendu est une étape séparée réalisée par l'utilisateur ou un outil qu'il a configuré.

## Entrées

- `{CLIENT_DIR}/01-deep-search/` : `01-market-awareness.md`, `02-competitor-research.md`, `03-psychographic.md`. Manquants → proposer de lancer `deep-search`, ou continuer sur les seules informations fournies en marquant les hypothèses.
- `{CLIENT_DIR}/02b-offre/offre-reconstruite.md` ou `00-onboarding/onboarding-form.md` : offre, prix, garantie, mécanisme, preuves, CTA.
- Mode : `coach-dtc` (défaut) ou `b2b-specialist`, choisi d'après la tonalité du brief ou demandé.

## Pipeline

1. **Synthèse avatar et marché** (bloc-notes interne) : ICP en 3 lignes, stade de conscience (1 à 5), sophistication (1 à 5), 5 douleurs verbatim, 3 croyances ou objections verbatim, dream outcome dans les mots du client, solutions déjà essayées et pourquoi elles ont échoué, ennemi commun, 3 hooks concurrents. Chaque phrase de la VSL doit remonter à l'un de ces éléments.
2. **Stratégie** : big idea (une phrase qui recadre le problème), mécanisme nommé (obligatoire si sophistication ≥ 3), promesse « [résultat] en [délai] sans [douleur], même si [objection] », composition de l'offre (résultat, délai, méthode, 3 à 5 insights, filet de sécurité, élément polarisant, prix et ancrage). Angle selon la sophistication : voir [references/frameworks.md](references/frameworks.md).
3. **Script** selon la structure du mode dans [references/script-structure.md](references/script-structure.md).
4. **Auto-audit** puis sauvegarde.

## Règles d'écriture

- Français oral, deuxième personne (tu par défaut, vous en B2B), phrases courtes, une idée par phrase, une émotion par bloc, paragraphe de 3 phrases max.
- Chaque phrase donne envie d'entendre la suivante.
- Verbatims de la recherche en italique.
- Mécanisme nommé une fois clairement puis répété 4 à 6 fois.
- Un seul CTA, répété deux fois à la fin. Jamais d'alternative.
- Aucune promesse sans preuve. Preuve manquante → placeholder `[PREUVE À FOURNIR : …]`, jamais un chiffre inventé.

## Auto-audit avant sauvegarde

Hook dans les 5 premières secondes · filtre pour qui / pas pour qui · bloc autorité avec 3 preuves concrètes · mécanisme nommé si sophistication ≥ 3 · au moins 2 verbatims · ennemi commun nommé · offre avec les 4 leviers de valeur · top 3 objections traitées · un seul CTA · longueur cible respectée (coach 1200 à 1800 mots, B2B 450 à 750) · aucune hyperbole (« incroyable », « révolutionnaire ») sans preuve.

## Sorties

```
{CLIENT_DIR}/04-vsl/
├── strategy.md     avatar, big idea, mécanisme, promesse, offre, angle
└── script-v1.md    script complet + notes de production (ton, rythme, b-roll suggéré)
```

Le mode B2B produit uniquement le script (voix off + texte à l'écran, sections en italique), sans stratégie visible : conserver la stratégie dans `strategy.md` quand même, l'utilisateur choisit ce qu'il transmet.

Pour un DOCX ou PDF, convertir avec l'outil disponible sur la machine ; le Markdown reste la source.

## Message de fin

Chemins, mécanisme, big idea, promesse, nombre de mots et durée estimée (≈ 150 mots par minute). Étape suivante : lecture à voix haute, puis production vidéo (voir `vsl-end-to-end-builder` pour le plan de montage).
