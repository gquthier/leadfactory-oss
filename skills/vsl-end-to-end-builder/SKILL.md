---
name: vsl-end-to-end-builder
description: Conduit un projet de Video Sales Letter de bout en bout — brief, benchmark, stratégie validée, script, plan de production et plan de diffusion — en produisant cinq documents Markdown dans le dossier client. À utiliser pour "faire une VSL de A à Z", "refonte de VSL", "vidéo de vente longue" ; pour un script seul à partir de rapports de recherche existants, préférer vsl-copywriter.
---

# VSL End-to-End Builder

Ce skill produit des **documents** : brief, stratégie, script, plan de production, plan de diffusion. La vidéo elle-même est tournée, montée ou générée par l'utilisateur avec ses propres outils. Ne jamais présenter le script ou le plan de montage comme une vidéo rendue ; si un outil de génération vidéo est configuré et utilisé, indiquer le fichier réellement produit et ce qui reste à faire.

## Sorties

```
{CLIENT_DIR}/04-vsl/
├── 00-brief.md
├── 01-strategy.md
├── 02-script.md
├── 03-production.md
└── 04-deployment.md
```

## Étapes

1. **Brief** (`00-brief.md`). Demander ce qui manque, en une seule salve : offre (produit, prix, modèle, garanties) ; ICP (persona, douleur n°1, désir n°1, stade de conscience, sophistication) ; objectif (CTA : appel / opt-in / achat, KPI cible, durée cible, plateforme) ; assets (témoignages, preuves chiffrées et leurs sources, footage existant, charte) ; contraintes (mentions légales, claims interdits, deadline). Si `{CLIENT_DIR}/01-deep-search/` existe, s'en servir.
2. **Benchmark** : 2 à 3 VSL de référence sur le même marché (fournies par l'utilisateur ou trouvées avec l'outil de recherche disponible) ; extraire hook, big idea, mécanisme, structure, durée ; identifier ce qui n'a pas encore été dit.
3. **Stratégie** (`01-strategy.md`) : big idea, promesse (résultat + délai + sans), mécanisme nommé et sa raison logique, angle (contrarien, nouveau, personnel, données, autorité), architecture émotionnelle en 9 blocs. **Faire valider avant d'écrire le script.**
4. **Architecture en 9 blocs** : hook (0–30 s) · problème · agitation (coût de l'inaction) · fausses solutions (sans attaquer) · mécanisme · preuves · offre et stack de valeur · renversement du risque · urgence légitime + CTA unique.
5. **Script** (`02-script.md`) : `[TIMESTAMP] [VISUEL / B-ROLL] — voix off`. Phrases courtes, ton parlé, une idée par phrase, transitions verbales fortes, CTA final formulé 2 à 3 fois. Durée ≈ 150 mots par minute. Hook sous 10 secondes, pas de jargon avant les preuves, stack de 3 à 7 éléments avec ancrage explicite, un seul CTA.
6. **Revue** : le hook fonctionne sans le son ; compréhensible à la première écoute ; chaque minute apporte une info ou une émotion ; mécanisme nommé ; objections principales traitées ; CTA sans ambiguïté ; durée dans ±15 % de la cible ; aucune preuve inventée.
7. **Production** (`03-production.md`) : plans et b-roll par segment, notes de ton et rythme, éléments graphiques (lower thirds, chiffres, logos), musique, plan de tournage ou, si génération IA prévue, liste des prompts et des outils choisis par l'utilisateur.
8. **Diffusion** (`04-deployment.md`) : page hôte (titre, sous-titre, CTA), tracking (pixel, UTM, événements), distribution (ads, organique, email, retargeting), tests prévus (hooks, miniatures, durées).

## Références

Schwartz (conscience), Sugarman (chaque phrase fait lire la suivante), Halbert (voix du client), Belcher/Brunson (hook → histoire → offre), Hormozi (stack, garantie, rareté). Une seule promesse principale par VSL.
