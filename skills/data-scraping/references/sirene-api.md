# API Recherche Entreprises (open data SIRENE / INSEE)

Base : `https://recherche-entreprises.api.gouv.fr/search` · gratuit · sans clé · données professionnelles publiques (licence ouverte Etalab, usage commercial autorisé).

Expose par entreprise : SIREN, raison sociale, NAF, dirigeants (avec année de naissance quand connue), effectif, nombre d'établissements, catégorie (PME/ETI/GE), nature juridique, date de création, commune du siège. Pas de chiffre d'affaires.

## Paramètres

| Paramètre | Exemple | Note |
|---|---|---|
| `activite_principale` | `75.00Z` | NAF avec le point (`NN.NNX`) |
| `departement` | `13` | filtre géographique principal |
| `tranche_effectif_salarie` | `02,03,11,12` | codes INSEE séparés par virgule |
| `categorie_entreprise` | `PME` | PME / ETI / GE |
| `page` | `1` | pagination |
| `per_page` | `25` | **maximum 25** ; au-delà la réponse arrive sans `results` |
| `q` | `NOM PRENOM` | recherche texte |

Sonde : `curl -s "https://recherche-entreprises.api.gouv.fr/search?activite_principale=75.00Z&departement=13&per_page=1" | python3 -m json.tool`

## Pièges

1. `per_page > 25` : pas d'erreur HTTP, juste pas de `results`.
2. Ne pas passer `minimal=true` : `siege` devient `null` (perte ville, CP, département, effectif). L'API refuse aussi `include=` sans `minimal`. Requêter sans ces deux paramètres : la réponse par défaut contient `siege` et `dirigeants`.
3. Tri par défaut : nombre d'établissements décroissant. Premières pages = groupes ; pages profondes = indépendants.
4. `annee_de_naissance` souvent absente : ne jamais rejeter une entreprise pour cette raison.
5. `qualite` souvent `null` pour les petites structures : le dirigeant existe quand même (`type_dirigeant: "personne physique"`).
6. Entreprise individuelle : la raison sociale est le nom de la personne, un seul dirigeant, souvent sans année ni qualité.

## Tranche d'effectif (code → borne basse de salariés)

`00`=0 · `01`=1 · `02`=3 · `03`=6 · `11`=10 · `12`=20 · `21`=50 · `22`=100 · `31`=200 · `32`=250 · `41`=500 · `42`=1000 · `51`=2000 · `52`=5000 · `53`=10000. PME de 3 à 49 salariés : `02,03,11,12`.

## Forme de réponse

```jsonc
{
  "results": [{
    "siren": "...", "nom_complet": "...", "nombre_etablissements": 1,
    "categorie_entreprise": "PME", "nature_juridique": "5710", "date_creation": "1988-02-15",
    "dirigeants": [{ "nom": "...", "prenoms": "...", "annee_de_naissance": null,
                     "qualite": null, "type_dirigeant": "personne physique" }],
    "siege": { "activite_principale": "75.00Z", "libelle_commune": "...", "code_postal": "...",
               "departement": "13", "tranche_effectif_salarie": "03" }
  }],
  "total_results": 0, "total_pages": 0
}
```

## Politesse

Backoff exponentiel sur 429 et 5xx (base ~800 ms, ×2, 5 essais max), ~250 ms entre pages, User-Agent explicite.

## Sources complémentaires gratuites

INPI RNE (dirigeants complets, actes), BODACC (annonces légales, cessions), dump SIRENE complet (INSEE). Payant si nécessaire : services type Pappers pour le chiffre d'affaires et l'actionnariat.
