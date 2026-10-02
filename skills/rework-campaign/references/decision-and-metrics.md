# Framework de décision et métriques

Défauts à surcharger par le mandat client.

## Gates préalables (un échec → pas de verdict)

- Tracking : événements de conversion < 24 h, clics > 0, un autre ad set convertit.
- Maturité : hors `Learning` / `Learning Limited`, âge ≥ 3 j (idéal 7), ≈ 50 événements / 7 j.
- Volume : hook et CTR ≥ 1000 à 2000 impressions ; CPL et kill ≥ 30 à 50 conversions ou dépense ≥ plancher absolu.
- Attribution : fenêtre d'évaluation ≥ fenêtre d'attribution (7-day click), jours clôturés seulement.
- Confiance : action automatique à ≥ 90 % ; sinon recommandation humaine.

## Plancher absolu anti-faux-kill

`plancher = max(5 × CPL cible, ≈ 500 € équivalent)`. À 1 à 2 × CPL de dépense, zéro lead arrive souvent par hasard sur une créative saine ; à 3 × CPL la confiance approche 95 %. Budget minimal par ad set (diagnostic, jamais hausse auto) ≈ CPA cible × 7 ; en dessous, recommander la consolidation.

## Verdicts

- **HARD KILL** (autorisé même en apprentissage) : dépense ≥ plancher ET leads = 0 ET tracking ok ET impressions ≥ 5000 → pause + alerte (pixel, offre, audience ou formulaire cassé).
- **KILL perf** (J10+, hors apprentissage) : CPL > 2 × cible (2,5 à 3 × en e-commerce) sur 5 à 7 jours ouvrés consécutifs avec volume → pause. Zone grise 1,5 à 2 × : budget −20 % max, réévaluer sous 48 à 72 h. 1,1 à 1,3 × : +3 jours d'observation.
- **KILL créa** : hook rate < 15 % à ≥ 2000 impressions et 0 conversion → pause ; 15 à 25 % → flag.
- **ITERATE** (fatigue, ad mature ayant eu un pic) : fréquence 7 j > 3 (froid) avec CTR −30 % vs pic, ou CPM +40 % vs base 14 j, ou CTR −15 à 25 % persistant sur 2 lectures. Paliers : fréquence 2,5 / perf −10 à 15 % → budget −25 % ; 3,5 / −20 à 30 % → −50 % ; CPM ×2 ou CTR −40 % → pause + régénérer.
- **SCALE** : CPL ≤ cible sur ≥ 3 à 5 jours consécutifs, hors apprentissage, CTR stable ou en hausse, fréquence < 2, idéalement ≥ 8 conversions / jour sur 4 jours. Hausse = limite sans réinitialisation lue via l'API (repli +15 à 20 %), max 1 / 72 h, 2 / semaine. Horizontal (fréquence > 3 ou CPA marginal > +25 %) : dupliquer vers une nouvelle audience. Arrêt quand le CPA marginal dépasse +25 % de la base ou 80 à 90 % de la LTV.
- **KEEP** : tout le reste.

## Consolidation

`nb_adsets_max = floor(budget_jour / (CPA cible × 7))`. Chevauchement d'audience : < 20 % ok ; 20 à 30 % surveiller ; > 30 % fusionner ou exclure. Structure cible : 1 à 3 ad sets par campagne, variation au niveau créative. Faire toutes les modifications en une fois (chaque édition réinitialise l'apprentissage). Éditions qui réinitialisent : événement d'optimisation, audience, créative, placements, enchère, budget au-delà de la limite, pause > 7 j, nouvelle ad dans l'ad set.

## Insights API

```
GET /act_{id}/insights?level=ad&date_preset=last_7d&limit=500
 &fields=ad_id,ad_name,adset_id,campaign_id,spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,
  actions,cost_per_action_type,inline_link_clicks,inline_link_click_ctr,outbound_clicks,
  video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,
  video_p100_watched_actions,video_thruplay_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking
```

Créative : `GET /{ad_id}?fields=creative{id}` puis `GET /{creative_id}?fields=image_url,thumbnail_url,video_id,object_story_spec,asset_feed_spec,body,title`.

`actions[]` et `cost_per_action_type[]` sont des tableaux `{action_type, value}`. Lead : `lead`, `offsite_conversion.fb_pixel_lead`, `onsite_conversion.lead_grouped`. Recalculer le CPL soi-même (`spend / leads`).

## Formules et repères

hook = vues 3 s / impressions (< 20 à 25 % faible, > 35 % fort) · hold = thruplay / vues 3 s (< 30 % faible, > 50 % fort) · CTR lien = clics lien / impressions (< 0,6 % cold B2B faible, > 1,2 % bon) · CVR = leads / clics lien (formulaire instantané ≈ 10 à 15 %, landing froide 1 à 3 %) · CPL = dépense / leads · fréquence 7 j cold : < 2,5 ok, > 3 fatigue · rankings `below_average` sur ≥ 2 axes = créative faible. Sortie d'apprentissage ≈ 50 événements / 7 jours glissants / ad set. Exclure le jour courant.
