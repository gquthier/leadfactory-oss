# Travailler avec cette agence

Ce dépôt contient un cockpit local, des méthodes d’agence, 23 skills et une intégration à BizOS local. Commencer par `README.md`, puis `vault/Start here.md` pour le contexte métier. Charger uniquement le dossier du client concerné et le skill approprié dans `docs/SKILLS.md`.

## Choisir le contexte d’exécution

Le cockpit autonome démarre par `npm start` à la racine et utilise `data/` dans le clone. Il ne crée pas d’agents. Le dossier `vault/` est un modèle à personnaliser ; lire ses rôles ne les exécute pas.

Dans BizOS local, **Apps → Agence LeadFactory → Installer** crée six agents, leur équipe, les 23 skills et un vault dédié sans remplacer le second cerveau existant. Le runtime intégré sous `integrations/bizos-local/runtime/` réalise cette installation ; le JSON de template en fournit les données. L’ouverture du cockpit depuis BizOS lance une session locale authentifiée.

Les outils `agency_*` et ce cockpit partagent les clients, campagnes, tâches, livrables et l’onboarding. Quand ces outils sont disponibles, les utiliser pour enregistrer le travail métier ; ne pas modifier directement les fichiers de base ou de connexion. Les notes Markdown complètent cet enregistrement. Sans ces outils, produire le livrable dans le dossier autorisé et identifier l’import restant à faire, sans prétendre avoir synchronisé BizOS.

## Exécuter une mission

Utiliser le dossier client autorisé et préserver les frontières entre clients. Enregistrer le brief, les hypothèses, les sources, le livrable et la prochaine action. Les accès aux services se configurent dans l’environnement choisi, jamais dans les notes ou Git.

Dans BizOS, le modèle des agents se configure dans les réglages avec la connexion personnelle de l’utilisateur. En mode autonome, la rédaction directe OpenRouter est facultative et distincte des modèles de texte déterministes. Les skills utilisent uniquement les outils effectivement disponibles ; distinguer instruction, tentative, résultat observé et action externe exécutée. Aucune routine n’est activée par défaut ; la présence d’un skill ou d’un token ne vaut pas autorisation d’envoi, de diffusion ou de dépense.

Le cockpit recherche les changements toutes les trois secondes et préserve les saisies ou brouillons non enregistrés. Respecter ce comportement lors des modifications d’interface.

## Modifier le code

Vous n’êtes pas seul dans le dépôt : limiter les écritures au lot confié et préserver les modifications des autres. Garder le cockpit autonome sans dépendances, sa persistance portable et son démarrage Node.js 22. Le runtime BizOS possède ses propres dépendances et commandes : voir `docs/BIZOS.md`.

Utiliser des fixtures fictives et vérifier le comportement modifié. Ne pas committer `data/`, profils locaux, exports personnels, captures de vrais clients, secrets ou logs d’agents. Le kit est MIT ; le runtime intégré est AGPL-3.0-only, avec ses notices amont. Préserver ces périmètres et attributions.

Décrire séparément ce que le code implémente, les tests réellement passés et le parcours observé dans l’application. Ne pas annoncer de binaire public ni de validation desktop complète sans preuve correspondante.
