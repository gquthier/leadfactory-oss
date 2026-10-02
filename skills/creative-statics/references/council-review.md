# Revue en conseil — 4 regards (5 en V2)

Chaque regard reçoit : les créatives (images ou spécifications), le brief visuel, le copy pack, les interdits de marque. Il ouvre chaque créative, note sur 10, donne 3 corrections chirurgicales avec valeurs (px, hex, mots), et écrit son verdict dans `creatives/v{N}/_council/0{n}-{regard}.md`.

| # | Regard | Questions |
|---|---|---|
| 1 | Garde de marque | Voix, interdits, mécanisme nommé, cohérence avec le site et le ton du fondateur |
| 2 | Recherche UX | Arrêt du défilement, clarté en 2 secondes, friction du CTA, biais d'interprétation |
| 3 | Design UI | Hiérarchie, typographie, contraste, composition, zones sûres |
| 4 | Copywriter | 6 checks, traçabilité, jargon, voix, spécificité |
| 5 | Fidélité du rendu IA (V2 uniquement) | Artefacts (mains, texte déformé, logo halluciné), lisibilité du texte rendu, cohérence produit et marque, effet « vallée dérangeante » |

Gabarit de prompt par regard :

```
Tu es {regard}. Client : {client}. Interdits : {liste}. Mécanisme : {nom}.
Pour chaque créative de {dossier} : score /10, 3 corrections précises et chiffrées, 1 phrase sur ce qui fonctionne.
Termine par un verdict global et les 2 créatives à garder telles quelles.
```

Synthèse obligatoire dans `_strategy.md` de la version suivante : consensus, ce qui change, angles à pousser, angles à abandonner.
