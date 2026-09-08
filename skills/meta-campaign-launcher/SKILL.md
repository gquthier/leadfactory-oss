---
name: meta-campaign-launcher
description: Configure une campagne Meta Ads complète (campagne, ad sets, ciblage, formulaire instantané ou pixel, créatives, annonces) via la Graph API, tout en statut PAUSED, à partir d'une proposition de campagne validée et d'un jeton fourni par l'environnement de l'utilisateur. À utiliser pour "crée la campagne Meta de {client}", "mets les créas en campagne", "setup compte Ads" ; pas pour rédiger la proposition (campaign-proposal) ni pour optimiser un compte qui tourne (rework-campaign).
---

# Meta Campaign Launcher

Tout est créé en **PAUSED** : rien ne diffuse, rien ne dépense tant qu'un humain n'active pas. Aucune suppression ni archivage sans demande ciblée. Le jeton (System User, scopes `ads_management`, `pages_manage_ads`, `leads_retrieval`, `business_management`) vient de la variable d'environnement `META_ACCESS_TOKEN` ou d'un fichier `.env` de l'utilisateur ; ne jamais le demander ni l'afficher dans la conversation. Sans jeton → livrer un plan de configuration (JSON des objets à créer) et s'arrêter.

## Modes

| Mode | Objectif | Destination | Prérequis |
|---|---|---|---|
| LEADGEN (défaut services) | `OUTCOME_LEADS` | formulaire instantané | CGU Lead Ads acceptées sur la Page (action humaine), un formulaire |
| CONVERSION | `OUTCOME_SALES` ou `OUTCOME_LEADS` site | landing + pixel | pixel installé, événement (`Lead`, `Purchase`) |

## Phases

- **A. Jeton** : `debug_token`, confirmer les scopes. Utiliser une version Graph actuellement supportée par le compte et le connecteur, vérifiée dans la documentation officielle Meta ; consigner cette version, sans reprendre un numéro historique par défaut.
- **B. Pré-vol, lecture seule** : `account_status` (1 = actif ; 2 = désactivé → STOP, révision côté utilisateur), `funding_source` (absent → campagne, ad set, créative et formulaire possibles, **pas les ads**), Page accessible, `leadgen_tos_accepted` (LEADGEN) ou pixels du compte (CONVERSION). Prérequis manquant → documenter et demander l'action humaine, ne pas forcer.
- **C. Formulaire ou pixel** : réutiliser un formulaire existant (`GET /{page_id}/leadgen_forms`) ou en créer un avec URL de politique de confidentialité obligatoire ; CONVERSION : `pixel_id` + événement.
- **D. Campagne(s)** : objectif selon mode, `status=PAUSED`, `is_adset_budget_sharing_enabled=false` si budget au niveau ad set. Souvent une campagne Broad et une Intérêts pour comparer à budget égal, ou la structure de la proposition.
- **E. Ad sets** : `daily_budget` en centimes, `bid_strategy=LOWEST_COST_WITHOUT_CAP`, `dsa_beneficiary` + `dsa_payor` (nom légal du client, obligatoire en UE), `destination_type` `ON_AD` ou `WEBSITE`, `promoted_object` (page ou pixel + événement), ciblage géo, âge, langue, intérêts (`GET /search?type=adinterest&q=…`). Advantage+ Audience force `age_max ≥ 65` : pour un ciblage strict, ne pas l'activer.
- **F. Créatives et ads** : upload images (`POST /act_ID/adimages` → hash). Soit DCO (`is_dynamic_creative=true` sur l'ad set, `asset_feed_spec` ≤ 10 images), soit ads dédiées par groupe de placements (Feed ; Stories/Reels) pour plus de 10 visuels et un meilleur contrôle. Ne plus envoyer `degrees_of_freedom_spec.standard_enhancements` (obsolète). Tout en PAUSED.
- **G. Vérification et récap** : relire `account_status` et `effective_status` de chaque objet ; livrer `{CLIENT_DIR}/07-meta-setup/recap.json` (campaign_ids, adset_ids, ad_ids, form_id ou pixel_id, erreurs) + liste des actions humaines restantes (URL de confidentialité réelle, moyen de paiement, activation, révision du compte).

Endpoints, champs et sous-codes d'erreur → correctif : [references/graph-api-constraints.md](references/graph-api-constraints.md).

## Garde-fous

Pré-vol avant toute écriture · PAUSED partout · jamais destructif · jeton jamais imprimé · activation et paiement restent côté utilisateur · si une écriture échoue soudainement, relire `account_status` (suspension possible à tout moment).
