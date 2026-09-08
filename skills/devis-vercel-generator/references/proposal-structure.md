# 12 sections de la proposition

1. **En-tête** : logo, référence, date d'émission, validité.
2. **Titre** : `dream_state.headline_hook` (« X. Y. Sans Z. ») + 3 puces « Fini les … » + prix de l'offre test + bouton ou lien de paiement (si existe) + bouton PDF + note de validité. Badge « Offre test, sans engagement » seulement si c'est vrai.
3. **Parties** : émetteur (nom légal, représentant, email, adresse) · destinataire (nom, société, rôle, email, téléphone, adresse) depuis le brief.
4. **Ce que vous obtenez** : 4 à 6 cartes (campagnes ; pré-qualification ; prise de `{meeting_word}` ; équipe dédiée ; plateforme ou suivi ; formation ou bonus) — chaque carte décrit un livrable réel de l'émetteur, adapté au rayon, à la ville et à `{customer_word}`.
5. **Preuves** : uniquement des chiffres et notes fournis par l'émetteur avec leur source ; sinon la section est remplacée par 2 témoignages autorisés, ou omise.
6. **Simulateur** : entrées (panier moyen = `avg_basket_eur`, budget média, coût par lead hypothétique, conversion lead → `{meeting_word}`, conversion `{meeting_word}` → `{deal_word}`) ; formules affichées :

```
leads = budget / coût_par_lead
rendez-vous = leads × conv_lead_rdv
affaires = rendez-vous × conv_rdv_affaire
chiffre_estimé = affaires × panier_moyen
investissement = budget + prix_offre
```
Mention obligatoire : « Simulation à partir d'hypothèses modifiables, sans garantie de résultat. »

7. **Détail du devis** : lignes (libellé, description, prix), total HT, TVA si applicable, total TTC. Total = somme explicite.
8. **Comparaison marché** (optionnelle) : uniquement avec des références sourcées ; sinon omettre.
9. **4 étapes** : lancement (géo), production, diffusion et qualification, bilan et décision ; `{deal_word}` en étape 4.
10. **Conditions** : durée, engagement, paiement, ce qui est inclus et exclu, objectif de test formulé comme hypothèse, résiliation, propriété des comptes et des données.
11. **Appel à l'action** : « Prêt à recevoir vos premiers `{meeting_word_plural}` qualifiés ? » + lien.
12. **Pied de page** : émetteur, tagline, référence, validité, mention « proposition commerciale à valider par les deux parties ».

## `proposition.json`

```json
{"ref": "…", "issued_at": "…", "valid_until": "…",
 "issuer": {"legal_name": "…", "representative": "…", "email": "…", "address": "…"},
 "recipient": {"name": "…", "company": "…", "role": "…", "email": "…", "phone": "…", "address": "…"},
 "vocab": {"deal_word": "…", "customer_word": "…", "meeting_word": "…"},
 "headline": "…", "bullets": ["Fini les …", "Fini les …", "Fini les …"],
 "lines": [{"label": "…", "description": "…", "price_eur": 0}], "total_ht_eur": 0, "vat_rate": 0.2, "total_ttc_eur": 0,
 "simulator_defaults": {"avg_basket_eur": 0, "ad_budget_eur": 0, "cpl_eur": 0, "conv_lead_meeting": 0.5, "conv_meeting_deal": 0.2},
 "payment_link": null, "proofs": [{"claim": "…", "source": "…"}]}
```
