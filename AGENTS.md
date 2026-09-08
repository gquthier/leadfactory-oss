# Travailler avec cette agence

Ce dépôt contient un cockpit local, des méthodes d'agence et des skills. Commencer par `README.md`, puis `vault/Start here.md` pour le contexte métier. Charger uniquement le dossier du client concerné et le skill approprié dans `docs/SKILLS.md`.

Le dossier `vault/` est un modèle à personnaliser. Les rôles sous `vault/Agents/` ne prouvent pas l'existence d'agents en exécution. Le JSON de template BizOS est un format de données ; son import dans l'application reste à intégrer.

Pour une mission client, demander ou utiliser le dossier autorisé. Ne pas mélanger les données de deux clients. Enregistrer le brief, les hypothèses, les sources, le livrable et la prochaine action dans ce dossier. Les accès aux outils se configurent dans l'environnement choisi, pas dans les documents ou Git.

Les brouillons du cockpit sont des modèles de texte déterministes. Les skills peuvent utiliser les outils effectivement disponibles ; signaler une dépendance absente et distinguer instructions, tentative, résultat observé et action externe réellement effectuée. La présence d'une méthode ou d'un token ne vaut pas autorisation d'envoi, de diffusion ou de dépense.

Pour modifier le code : garder le démarrage sans dépendances et la persistance portable, utiliser des fixtures fictives et vérifier le comportement modifié. Ne pas committer `data/`, exports personnels, captures de vrais clients, secrets ou logs d'agents.
