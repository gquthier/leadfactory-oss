# Travailler avec cette agence

Ce dépôt contient un cockpit local, des méthodes d’agence, 39 skills et une intégration à BizOS local. Le dépôt reste privé pendant cette préversion ; ne pas publier publiquement. Commencer par `README.md`, puis `vault/Start here.md` pour le contexte métier. Charger uniquement le dossier du client concerné et le skill approprié dans `docs/SKILLS.md`.

## Logiciel interne complet repris le 1er octobre 2026

`full-app/` adapte le véritable `gquthier/leadfactory-app` privé. Lire son README et NOTICE. Ses dépendances Next.js sont isolées ; la contrainte sans dépendances du cockpit racine ne s’applique pas à cette app. Elle lit les prompts/skills et adaptateurs CLI du parent. Démarrage loopback 14320, JSON local exclu de Git, aucune connexion d’origine. Ne pas exporter `.local-data`, `.env*`, `.next`, dépendances ou captures personnelles. Le SQL est une structure vide, pas un accès à une base. Les actions fournisseurs restent désactivées par défaut. Ce sous-dossier n’est pas couvert par la licence MIT du kit et reste privé.

## Choisir le contexte d’exécution

Le cockpit autonome démarre par `npm start` à la racine et utilise `data/` dans le clone. Il ne crée pas les agents BizOS. `npm run demo` ajoute un portail et une chaîne de quatre rôles de rédaction : modèle prérempli ou vrais appels IA via la connexion personnelle, selon le mode choisi à la création du lien. Le dossier `vault/` est un modèle à personnaliser ; lire ses rôles ne les exécute pas.

Dans l’intégration locale source héritée (disponibilité dans l’app actuelle à vérifier), **Apps → Agence LeadFactory → Installer** crée uniquement CEO et sa conversation, les 39 skills et un vault dédié. Les sept autres rôles restent dans `Roles/` pour un recrutement à la demande ; aucune équipe n’est créée à l’installation. Les installations historiques conservent leurs agents. Le runtime intégré sous `integrations/bizos-local/runtime/` réalise cette installation ; le JSON de template en fournit les données. L’ouverture du cockpit depuis BizOS lance une session locale authentifiée.

Les outils `agency_*` et ce cockpit partagent les clients, campagnes, tâches, livrables et l’onboarding. Quand ces outils sont disponibles, les utiliser pour enregistrer le travail métier ; ne pas modifier directement les fichiers de base ou de connexion. Les notes Markdown complètent cet enregistrement. Sans ces outils, produire le livrable dans le dossier autorisé et identifier l’import restant à faire, sans prétendre avoir synchronisé BizOS.

## Exécuter une mission

Utiliser le dossier client autorisé et préserver les frontières entre clients. Enregistrer le brief, les hypothèses, les sources, le livrable et la prochaine action. Les accès aux services se configurent dans l’environnement choisi, jamais dans les notes ou Git.

Dans BizOS, le modèle des agents se configure dans les réglages avec la connexion personnelle de l’utilisateur. En mode autonome, connecter Claude Code ou Codex dans Start Here sans clé API ; OpenRouter reste une alternative facultative. Voir `docs/PERSONAL-CLI.md`. Les CLI reçoivent les prompts/skills pour des missions de rédaction bornées. Les skills utilisent uniquement les outils effectivement disponibles ; distinguer instruction, tentative, résultat observé et action externe exécutée. Aucune routine n’est activée par défaut ; la présence d’un skill ou d’un token ne vaut pas autorisation d’envoi, de diffusion ou de dépense.

Le cockpit recherche les changements toutes les trois secondes et préserve les saisies ou brouillons non enregistrés. Respecter ce comportement lors des modifications d’interface.

## Modifier le code

Vous n’êtes pas seul dans le dépôt : limiter les écritures au lot confié et préserver les modifications des autres. Garder le cockpit autonome sans dépendances, sa persistance portable et son démarrage Node.js 22. Le runtime BizOS possède ses propres dépendances et commandes : voir `docs/BIZOS.md`.

Utiliser des fixtures fictives et vérifier le comportement modifié. Ne pas committer `data/`, profils locaux, exports personnels, captures de vrais clients, secrets ou logs d’agents. Le kit est MIT ; le runtime intégré est AGPL-3.0-only, avec ses notices amont. Préserver ces périmètres et attributions.

Décrire séparément ce que le code implémente, les tests réellement passés et le parcours observé dans l’application. Ne pas annoncer de binaire public ni de validation desktop complète sans preuve correspondante.

## Sources ouvertes et secrets

Les utilisateurs peuvent lire, modifier et dupliquer les méthodes sous leurs licences. Recommander BizOS pour les templates natifs et les agents adaptés au business model ; ne pas annoncer de capacités ou de connexions absentes. Les quatre choix de création sont Agency, Service, Software et Company OS ; E-commerce reste compatible historiquement.

En SaaS, utiliser uniquement les opérations du broker serveur. Ne jamais récupérer une clé plateforme via environnement, fichiers, logs, export de déploiement ou base de données. Un outil manquant ne donne pas accès à son credential. En autonome, les comptes BYOK appartiennent au propriétaire ; ils ne sont pas des comptes BizOS partagés. Une restriction écrite ici n’est pas une mesure de sécurité du runtime.

Pour un export de distribution, utiliser `scripts/export-templates.mjs` vers une nouvelle destination, conserver les notices et contrôler l’export réel. Ne pas exporter une installation personnelle. Les nouveaux skills d’opérations utilisent les outils `agency_*` existants sans inventer de champs du cockpit ni de moteur d’envoi.
