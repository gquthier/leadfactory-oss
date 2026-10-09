# Travailler avec ce dépôt

Ce dépôt contient le cockpit local d'une agence lead gen et 23 skills. Commencer par `README.md`. Pour une mission, charger uniquement le dossier du client concerné et le skill approprié (voir `docs/SKILLS.md`).

## Exécuter une mission

Le cockpit démarre par `npm start` et stocke ses données dans `data/`. Préserver les frontières entre clients. Enregistrer le brief, les hypothèses, les sources, le livrable et la prochaine action. Les accès aux services se configurent dans l'environnement de l'utilisateur, jamais dans les notes ou Git.

Les skills utilisent uniquement les outils effectivement disponibles ; distinguer instruction, tentative, résultat observé et action externe exécutée. La présence d'un skill ou d'un token ne vaut pas autorisation d'envoi, de diffusion ou de dépense.

Le cockpit recherche les changements toutes les trois secondes et préserve les saisies ou brouillons non enregistrés. Respecter ce comportement lors des modifications d'interface.

## Modifier le code

Garder le cockpit sans dépendances, sa persistance portable et son démarrage Node.js 22. Utiliser des fixtures fictives et vérifier le comportement modifié avec `npm test`. Ne pas committer `data/`, exports personnels, captures de vrais clients, secrets ou logs. Le kit est MIT ; préserver les attributions des skills adaptés.
