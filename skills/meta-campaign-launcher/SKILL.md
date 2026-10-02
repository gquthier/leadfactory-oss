---
name: meta-campaign-launcher
description: Configurer une campagne Meta Ads depuis un plan validé, avec contrôles du compte, objectifs, budget, identité, destination, créatives et états relus. Préparation en pause par défaut ; activation selon mandat explicite existant.
---
# Configuration d’une campagne Meta

Commencer par `agency-media-buying` pour le plan et les mesures. Ce skill réalise la configuration, pas une promesse de résultats.

1. Reprendre client, ad account, Page/profil, offre, destination, objectif/évènement, budget/devise, planning et mandat. Relire les objets existants pour éviter les doublons.
2. Vérifier les capacités du connecteur réellement disponible et la documentation officielle de sa version. Un outil d’audit/pause/budget n’est pas un outil de création. Si la capacité manque, livrer le plan de setup ou utiliser l’interface autorisée, sans inventer un appel.
3. Contrôler état du compte, permissions, identité, contraintes de catégorie/audience, facturation et destination. Un blocage plateforme est documenté, pas contourné. La présence/absence d’un champ historique ne permet pas de déduire à elle seule quelles écritures sont possibles aujourd’hui.
4. Choisir les champs actuellement compatibles : objectif, conversion location, formulaire ou dataset/évènement, ciblage/exclusions, placements et formats, stratégie d’enchère, niveau de budget et planning. Convertir le montant dans l’unité attendue pour cette devise/API ; jamais supposer « centimes » universellement.
5. Créer ou réutiliser campagne, ad sets, créatives et annonces selon le plan. Pour une mission de préparation, maintenir tous les objets en pause. Pour une activation déjà mandatée, appliquer uniquement les paramètres et plafonds autorisés après QA.
6. Relire IDs, configuration et statut effectif ; vérifier URL/formulaire, aperçu et tracking. Consigner avant/après et erreurs. Timeout ambigu : réconcilier les objets existants avant retry.
7. Livrer `07-meta-setup/recap.json` sans secret : compte/client, IDs, version de l’outil/API, valeurs relues, état, preuve, anomalies et prochaines actions.

Les références [historiques d’API](references/graph-api-constraints.md) sont des pistes à revalider ; les limites, champs retirés et prescriptions de ciblage peuvent avoir changé. La page officielle de création n’a pas pu être relue pendant le packaging du 1er octobre 2026 (429). Vérifier au moment de l’exécution.

En SaaS, utiliser le broker autorisé ; en autonome, la connexion personnelle configurée. Ne jamais chercher ni exporter une clé de plateforme. Aucun script de création/provider n’est fourni ou activé par la présence de ce skill.
