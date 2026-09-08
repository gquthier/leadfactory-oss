# Gabarit `proposition-campagne.md`

```markdown
# Proposition de campagne Meta Ads — {Client}
{{AGENCY_NAME}} · {date}

## 1. Brief stratégique et objectif de test
[4 à 7 phrases. « L'objectif de cette première phase est de … Pour y parvenir, on lance … On cherche à valider … »]

## 2. Formulaire de qualification        ← si Instant Form
### Question 1 — [Énoncé]
Type : choix unique · Options : A / B / C / D
### Question 2 — …
### Règle de qualification
Lead qualifié si … · Lead tiède si … · Lead disqualifié si …

## 2. Script VSL                          ← si funnel VSL
### Bloc 1 — [Titre] (00:00–00:15)
[voix off]
…

## 3. Structure des campagnes
### Campagne 1 — [CLIENT] - [OFFRE] - [OBJECTIF] - [AAAA-MM]
Objectif Meta : … · Budget quotidien : … · Durée du test : …

#### Ad set 1 — Intérêts
Géo · âge · sexe · langue · intérêts (3 à 8) · taille estimée
#### Ad set 2 — Broad
Géo · âge · sexe · langue · aucun intérêt · taille estimée

#### Créatives ({N}, images statiques)
##### Créative 1 — [Nom] (Angle : Douleur)
Format : image statique 1080×1350
Headline image : …
Primary text : …
##### Créative 2 — [Nom] (Angle : Désir)
…
```

Si l'utilisateur demande explicitement des scripts vidéo : remplacer le bloc créative par Hook (0–3 s) / Body / CTA, 30 s minimum.

## Export JSON optionnel (import manuel dans un outil)

```json
{
  "brief": "…",
  "qualification": "…",
  "campaigns": [{
    "name": "…", "objective": "Leads", "dailyBudget": "50 €/jour", "testDuration": "14 jours",
    "adSets": [{"name": "Intérêts", "geo": "…", "age": "…", "sex": "…", "interests": "…"},
               {"name": "Broad", "geo": "…", "age": "…", "sex": "…", "interests": "aucun"}],
    "creatives": [{"name": "…", "angle": "Douleur", "format": "Image statique 1080x1350", "headline": "…", "primaryText": "…"}]
  }]
}
```
