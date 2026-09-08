# Graph API — endpoints, champs, erreurs

Base `https://graph.facebook.com/{version}` · auth `access_token` · hiérarchie : Campaign → Ad Set → Ad → Ad Creative ; Lead Form sur la Page ; Pixel sur le compte.

## Endpoints

| Action | Méthode | Endpoint |
|---|---|---|
| Vérifier le jeton | GET | `/debug_token?input_token=TOKEN&access_token=APPID|APPSECRET` |
| Comptes | GET | `/me/adaccounts?fields=id,name,account_status,currency` |
| État du compte | GET | `/act_ID?fields=name,account_status,disable_reason,currency,funding_source` |
| Jeton de Page | GET | `/PAGE_ID?fields=access_token` |
| CGU lead ads | GET | `/PAGE_ID?fields=leadgen_tos_accepted` |
| Formulaires | GET | `/PAGE_ID/leadgen_forms?fields=id,name,status` |
| Pixels | GET | `/act_ID/adspixels?fields=id,name` |
| Intérêt | GET | `/search?type=adinterest&q=…&limit=5` |
| Campagne | POST | `/act_ID/campaigns` |
| Ad set | POST | `/act_ID/adsets` |
| Formulaire | POST | `/PAGE_ID/leadgen_forms` (jeton de Page) |
| Image | POST | `/act_ID/adimages` (multipart) → `images.<fn>.hash` |
| Créative | POST | `/act_ID/adcreatives` |
| Ad | POST | `/act_ID/ads` |

## Sous-codes d'erreur rencontrés → correctif

| subcode | Cause | Correctif |
|---|---|---|
| 4834011 | budget partagé non précisé | `is_adset_budget_sharing_enabled=false` sur la campagne |
| 2490487 | stratégie d'enchère manquante | `bid_strategy=LOWEST_COST_WITHOUT_CAP` |
| 3858081 | DSA manquant (UE) | `dsa_beneficiary` + `dsa_payor` sur l'ad set |
| 1870189 | `age_max < 65` avec Advantage Audience | `targeting_automation.advantage_audience=0` |
| 1359188 | aucun moyen de paiement | ajouter un moyen de paiement (humain) ; bloque uniquement les ads |
| 3858504 | `standard_enhancements` obsolète | retirer `degrees_of_freedom_spec` |
| 1815089 | CGU lead ads non acceptées | `facebook.com/ads/leadgen/tos?page_id=…` (humain) |
| 1892075 | politique de confidentialité manquante | `privacy_policy.url` sur le formulaire |
| 1885316 | compte désactivé | `account_status=2` → demande de révision (humain) |

## Champs d'ad set

`daily_budget` en centimes (1500 = 15 €) · `optimization_goal` `LEAD_GENERATION` ou `OFFSITE_CONVERSIONS` · `destination_type` `ON_AD` ou `WEBSITE` · `promoted_object` `{"page_id": …}` ou `{"pixel_id": …, "custom_event_type": "LEAD"}` · `is_dynamic_creative` (DCO, niveau ad set) · `status=PAUSED`.

## Placements

`publisher_platforms: ["facebook","instagram"]` · Feed : `facebook_positions=["feed"]`, `instagram_positions=["stream","explore"]` · Stories/Reels : `facebook_positions=["story","facebook_reels"]`, `instagram_positions=["story","reels"]` · omettre les positions = placements automatiques.

## Statuts

Campagne et ad set : `status` et `effective_status` = `PAUSED`. Ad : `effective_status` peut être `IN_PROCESS` (revue) tout en étant en pause. Compte : `account_status` 1 actif, 2 désactivé ; `disable_reason` 1 = politique d'intégrité. Locale français (France) = `6`.
