# Schéma normalisé du formulaire d'onboarding

Le formulaire arrive dans n'importe quel format (Typeform, Tally, Google Forms, PDF, texte collé, export Markdown/JSON d'un cockpit). Le normaliser dans `00-onboarding/onboarding-form.md` avec ce front matter.

```markdown
---
client_name: Nom du client
niche: Marché / secteur
product: Offre précise (produit ou service)
geography: Marché géographique (défaut France)
target_avatar: ICP en 1 à 2 phrases
competitors:
  - Concurrent A
  - Concurrent B
  - Concurrent C
funnel_type: instant_form        # instant_form | vsl
price_point: 0                   # euros HT
objectif_test:
  cpl_cible: 0                   # euros, hypothèse du client ou de l'agence
  volume_cible: 0                # leads / mois
  duree_test: 30                 # jours
  hypothese_a_valider: "..."
tonality: Voix de marque (tu/vous, registre, interdits)
differenciation: Mécanisme unique ou différenciation revendiquée
proof_assets:
  - "Témoignage / résultat client, avec sa source"
---

## Notes libres
Réponses libres du formulaire, telles quelles.
```

## Correspondance avec un export de cockpit

| Champ cockpit | Champ normalisé |
|---|---|
| entreprise / company | `client_name` |
| offre / offer | `product` |
| audience | `target_avatar` |
| objectif / goal | `objectif_test.hypothese_a_valider` |
| budget | `objectif_test` (budget mensuel → note) |
| notes | Notes libres |

Les champs absents de l'export (concurrents, funnel, prix, preuves) sont demandés à l'utilisateur.

## Usage aval

| Champ | Utilisé par |
|---|---|
| `client_name` | tous |
| `niche`, `product`, `geography`, `target_avatar` | deep-search, vsl-copywriter, meta-ads-copywriter |
| `competitors`, `geography` | competitor-ads-research |
| `funnel_type` | campaign-proposal, vsl-copywriter |
| `price_point`, `differenciation`, `proof_assets` | analyse d'offre, vsl, meta-ads |
| `objectif_test` | campaign-proposal |
| `tonality` | vsl (choix du mode), meta-ads |

## Champs bloquants

Sans l'un de ces champs, demander avant de lancer : `client_name`, `niche`, `product`, `geography`, `competitors` (au moins 2), `funnel_type`, `price_point`.

## Champs optionnels utiles

`landing_url`, `current_ads`, `crm_link`, `team_size`, `monthly_budget`.

## Preuves

Chaque élément de `proof_assets` doit être traçable (témoignage nommé, capture, chiffre avec source). Une preuve non vérifiable est notée `[À CONFIRMER]` et ne sera pas utilisée comme claim dans les livrables.
