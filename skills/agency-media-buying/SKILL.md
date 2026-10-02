---
name: agency-media-buying
description: Planifier, configurer, contrôler et optimiser des campagnes publicitaires client, avec spécialisation Meta lead generation, correspondance des comptes et preuves après chaque changement.
---

# Media buying — de l’économie au contrôle de diffusion

Entrées : client/campagne, offre, objectif business, critères de lead qualifié, budget/devise, dates/fuseau, comptes et droits, créatives, destination et suivi. Un mandat distingue création en pause, activation, budget et optimisation. Réutiliser les autorisations existantes, sans les élargir.

1. **Économie et mesure** : définir ce qui compte (lead, rendez-vous tenu, vente), événements, source de vérité et fenêtre d’attribution. Calculer CPL/CPA avec le bon dénominateur. Un CPL plafond peut être dérivé d’un CAC plafond et d’un taux lead→client observé ; sans taux fiable, présenter un scénario. ROAS n’est pas une marge.
2. **Audit lecture seule** : vérifier ad account, business propriétaire, Page/identité, permissions, devise/fuseau et limites. Relever compte désactivé, facturation bloquée, audience restreinte ou mesure manquante sans tenter de les contourner. Les connexions/jetons sont gérés par les outils de l’environnement.
3. **Parcours de conversion** : formulaire instantané ou site selon le brief. Vérifier URL finale, message-match, mobile, champs de qualification, destination des réponses/leads, confidentialité et évènement testé. Pixel/CAPI/déduplication se contrôlent avec des preuves si utilisés ; ne pas annoncer un Purchase réel depuis une fixture.
4. **Plan** : objectif et événement compatibles, structure campagne/ad sets/annonces, audience/exclusions, placements/formats, budget/plafond, enchère, dates, tracking et nomenclature. Rechercher les champs autorisés dans la version actuelle du connecteur/API. Aucun seuil de learning, ciblage broad ou stratégie d’enchère ne devient un dogme.
5. **Création** : utiliser `meta-campaign-launcher` et un outil autorisé de création réellement disponible. Garder la configuration en pause sauf activation déjà demandée. Si le connecteur ne sait qu’analyser/pause/budget, ne pas lui inventer un endpoint de création : produire le plan ou opérer Ads Manager si autorisé et disponible.
6. **Recette avant/après** : relire les IDs et les valeurs effectives du compte, campagne, ad sets et ads. Vérifier le budget dans l’unité/devise attendue par l’API, statut configuré ET effectif, planning, liens/UTM, prévisualisations et lead test autorisé. Rapprocher toute réponse timeout avant de recréer un objet.
7. **Pilotage** : comparer périodes et fenêtres cohérentes, tenir compte de l’échantillon et des délais de conversion. Séparer problème de mesure, offre, créative, audience et page. Prioriser une modification motivée, tracer avant/après, coût/plafond et retour arrière. Un changement de budget ne répond pas à un problème de créative par défaut.
8. **Relais** : envoyer au Creative Strategist les données par concept et hypothèses, à Delivery les dépendances/périmètre, à CEO l’arbitrage capacité/budget. Garder résultats et provenance par client.

Livrer `media-plan.md`, `setup.json` sans secret, preuves de recette et journal des changements. Statuts : proposé / configuré en pause / programmé / actif observé / refusé / inconnu. Aucun statut n’est déduit d’une promesse dans le prompt.

[Checklist de configuration](references/setup-checklist.md). La méthode est portable ; aucun accès Meta, connecteur live ou succès de campagne n’est inclus dans ce fichier.
