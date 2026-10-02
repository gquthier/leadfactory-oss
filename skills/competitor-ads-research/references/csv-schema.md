# Schéma `data.csv`

Une ligne par ad. UTF-8 sans BOM, séparateur virgule, guillemets doubles pour tout champ contenant virgule, retour à la ligne ou guillemet. Dates ISO `YYYY-MM-DD`. Champ vide accepté si non disponible.

| # | Colonne | Type | Description |
|---|---|---|---|
| 1 | `concurrent` | texte | Nom de la marque |
| 2 | `page_id` | texte | Id de la page (si connu) |
| 3 | `ad_id` | texte | Id de l'ad |
| 4 | `format` | enum | `FaceCam` / `UGC` / `Static` / `Carousel` / `VSL` / `Other` |
| 5 | `angle` | enum | `Douleur` / `Désir` / `Preuve` / `ContreIntuitif` / `Urgence` |
| 6 | `hook` | texte | Verbatim des 3 premières secondes ou première phrase |
| 7 | `primary_text` | texte | Texte primaire complet |
| 8 | `headline` | texte | Titre |
| 9 | `cta` | texte | Bouton |
| 10 | `start_date` | date | Début de diffusion |
| 11 | `last_seen` | date | Dernière observation |
| 12 | `days_active` | entier | `last_seen - start_date` |
| 13 | `winner` | bool | `days_active > 21` |
| 14 | `hero` | bool | `days_active > 60` |
| 15 | `evergreen` | bool | `days_active > 180` |
| 16 | `countries` | texte | Pays, séparés par virgule dans les guillemets |
| 17 | `platforms` | texte | `facebook,instagram,messenger,audience_network` |
| 18 | `media_path` | texte | Chemin local du média (vide en mode dégradé) |
| 19 | `media_type` | enum | `image` / `video` / `carousel` |
| 20 | `landing_url` | texte | URL de destination |
| 21 | `notes` | texte | Variantes détectées, remarques |
