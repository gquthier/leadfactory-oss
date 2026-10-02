# Contrôle visuel avant export

## Dimensions et formats

| Format | Pixels | Contrainte |
|---|---|---|
| Feed 4:5 | 1080×1350 | format prioritaire (environ 70 % du pack) |
| Story 9:16 | 1080×1920 | zones sûres haut et bas ≈ 220 px |
| Feed 1:1 / carrousel | 1080×1080 | indicateur de défilement, 4 slides max |

Poids : entre 80 Ko et 8 Mo. Espace couleur sRGB. Pas de fond transparent.

## Checklist

- [ ] Dimensions exactes.
- [ ] Un seul accent couleur, réservé au CTA (chip et stats restent dans la palette neutre).
- [ ] Contraste : hero ≥ 7:1, body ≥ 4.5:1, CTA ≥ 3:1 en grand texte ; jamais d'accent chaud sur fond clair pour un texte clé.
- [ ] Hook sur 3 lignes maximum, taille auto-réduite si nécessaire.
- [ ] CTA centré dans la zone sûre basse (≥ 14 % de la hauteur), pill à texte ≥ 37 px gras.
- [ ] Zone de texte ≈ 30 % de la surface, respiration ≈ 70 %.
- [ ] Deux familles de polices maximum.
- [ ] Nommage : `{client-slug}_{angle-id}_{format}.png`.
- [ ] Aucun élément de marque du client absent (logo, accent) ni ancien nom en cas de rebrand.

## Palette de base (tokens)

Fond sombre dominant · fond clair chaud · variante crème pour la descente tonale · accent client (CTA uniquement) · optionnels : vert confiance, gris labels, rouge alerte, navy doux pour cartes internes.

## Gate entre deux itérations

Aller en v+1 seulement si : score conseil moyen ≥ v précédente, zéro violation de contraste, angles distincts, copy tracée `[V][W][P][C]` sur 100 % des hooks. Sinon corriger la version courante.
