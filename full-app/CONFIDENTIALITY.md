# Revue de confidentialité et espaces clients — 1er octobre 2026

Cette revue complète la première vérification de la copie. Le contrôle précédent des secrets et contacts n’avait pas identifié tous les exemples commerciaux dans les prompts. Une référence d’entreprise, une ancienne offre datée, des résultats/prix utilisés comme exemples, des noms personnels dans les fixtures et des noms de projets dans l’inventaire local ont été retirés ou anonymisés. Leur présence dans un prompt ne prouve pas leur véracité ; ils n’ont aucune place comme faits préchargés dans le starter.

## Couverture

Scan de tous les fichiers suivis destinés à l’archive : code application, runtime fourni, méthodes, prompts, tests, documentation, schémas, manifests et locks. Recherche de secrets, clés privées, JWT, jetons, emails, téléphones, identifiants, URL, chemins personnels et affirmations commerciales chiffrées ; revue des correspondances et des parcours d’accès client/Meta. Les six fichiers binaires sont des polices WOFF2 livrées avec leurs notices. Les contrôles automatisés ne sont pas une lecture sémantique exhaustive de chaque ligne ni une preuve mathématique d’absence de données cachées.

Aucun secret ou contact client réel n’a été détecté dans la nouvelle distribution après corrections. Les valeurs de démonstration sont fictives et les seuils/formules de méthode ne sont pas des résultats de l’agence. Les noms des auteurs publics et les attributions de licences restent nécessaires ; les références GitHub de provenance identifient les sources demandées. Aucun client, prospect, fichier média client, session CLI, fichier de tokens, base JSON personnelle ou dump de production n’est inclus.

Ce constat porte sur les fichiers de la version et l’archive propre, **pas sur l’ancien historique Git**, le dépôt interne d’origine ni les archives historiques de travail. Le dépôt reste privé. Avant une distribution publique, utiliser l’export sans historique contrôlé ; ne pas publier un historique contenant les anciennes versions.

## Dashboard et comptes clients

Les routes `/client/overview`, `/client/campaigns`, `/client/crm`, `/client/leads`, `/client/todos`, `/client/formations`, `/client/settings` et les outils commerciaux/créatifs sont présentes. L’admin ouvre un aperçu depuis la fiche client. En mode local, cet aperçu utilise une identité administrative locale ; il n’est pas une connexion client indépendante.

La création locale enregistre profil, brief, campagne et tâches sans compte distant. Les routes historiques `api/admin/create-client` et `api/onboarding/finalize` contiennent bien la création Supabase Auth ; le SQL crée le profil lié. Elles nécessitent le propre projet/Auth et la messagerie de l’opérateur, plus une recette des permissions. Aucun compte réel créé pendant cette revue.

Un cookie d’aperçu ne vaut plus autorisation : l’identité est vérifiée côté serveur, le profil doit être administrateur actif et le client doit appartenir à son périmètre (super-admin, gestion directe ou affectation). Tests avec un faux cookie client, un admin hors périmètre, un admin affecté et un compte désactivé. Les paramètres n’envoient plus le profil complet au navigateur ; l’aperçu affiche le bon client en lecture seule pour le profil et réserve les connexions à la session réelle du client.

## Connexions Meta : présentes, pas certifiées en production

Le code inclut OAuth début/callback, échange de jetons, pages/Instagram, comptes publicitaires, statistiques, abonnement aux leads et webhooks. Les paramètres `FB_APP_ID`, `FB_APP_SECRET`, `META_REDIRECT_URI`, `META_LOGIN_CONFIG_ID`, `APP_ENCRYPTION_KEY`, tokens et actifs sont ceux de l’utilisateur.

Le formulaire de connexion du Start Here conserve un token personnel et peut tester l’identité ; il ne raccorde pas automatiquement ce token aux anciens adaptateurs Meta ni ne prouve l’accès aux campagnes. Le module de statistiques reste celui de l’ancien logiciel et sa version Graph doit être choisie/vérifiée via `META_GRAPH_VERSION` ; le fallback historique est v21.0. Les pages et appels Meta historiques sont bloqués en mode local, y compris lorsqu’un token existe déjà dans l’environnement. Un test vérifie zéro appel réseau dans ce cas.

Le mode distant nécessite configuration, recette Auth/RLS/Storage, validation des permissions Meta et choix explicite des actifs. Aucun compte Meta, webhook réel, publication, email ou dépense n’a été activé. Les pages officielles Meta ont renvoyé HTTP 429 pendant la revue : leur état actuel n’est pas présenté comme vérifié. Les liens de documentation sont disponibles dans Start Here.

## Validation

Tests application : 25 réussis ; pack : 141 ; runtime ciblé après anonymisation des fixtures : 55 ; Python outbound : 14. Build et TypeScript vérifiés. Les tests distants sont simulés ou désactivés ; aucun parcours de login d’un vrai client externe n’est certifié. La recette navigateur a ouvert onze vues client avec deux clients fictifs dans un répertoire temporaire séparé : aucun accès à la campagne de l’autre client, profil de l’aperçu correct, sortie d’aperçu testée, aucune erreur JavaScript ni requête externe. Les API crédits, surprises, notifications et suivi d’activité renvoient volontairement 501 en mode local : ces fonctions distantes ne sont pas présentées comme actives.
