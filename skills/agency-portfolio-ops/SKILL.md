---
name: agency-portfolio-ops
description: Piloter plusieurs clients d'agence dans le cockpit LeadFactory, préparer la revue quotidienne ou hebdomadaire et attribuer les prochaines actions selon la capacité et les blocages réels.
---

# Piloter le portefeuille clients

Commencer par le périmètre autorisé : tous les clients pour une revue de direction, ou seulement les identifiants confiés. Une mission sur le client A ne donne pas accès aux dossiers détaillés du client B. Pour une vue globale, lire d'abord les résumés ; ouvrir un dossier seulement lorsqu'une décision l'exige.

Dans BizOS, utiliser `agency_context`, puis `agency_clients` et les outils `agency_campaigns`, `agency_tasks`, `agency_deliverables` exposés au run. Leurs schémas font foi. Dans le cockpit autonome, utiliser ses vues ou un export JSON/Markdown fourni par le propriétaire. Ne pas écrire `db.json` ou un dossier de connexions.

## Construire une vue exploitable

Pour chaque client, relier `clientId`, statut, campagne et tâche par leurs identifiants persistés. Le cockpit conserve les statuts client `prospect`, `onboarding`, `actif`, `pause`, `termine`, les campagnes et les tâches terminées ou ouvertes. Le responsable, l'échéance, la capacité et le blocage sont des informations de coordination dans le compte rendu ; ne pas inventer des champs API absents.

Produire `Reports/Portfolio/<date>.md` dans le coffre autorisé :

| Client ID | Statut cockpit | Campagne ID | Responsable | Prochaine action / tâche ID | Échéance | Blocage | Capacité allouée | Preuve |
|---|---|---|---|---|---|---|---|---|

Une valeur inconnue reste « à confirmer ». Réutiliser les tâches ouvertes pour éviter les doublons. Si le responsable ou la date ne sont pas des champs du contrat exposé, les consigner dans le compte rendu lié et dans un titre de tâche explicite ; ne pas envoyer des champs ignorés à l'API. Définir les statuts des notes comme propositions tant qu'une écriture cockpit n'est pas confirmée.

## Revue

- **Quotidienne :** relever les échéances dépassées, briefs incomplets, validations attendues et prochaines actions sans responsable. Choisir les quelques actions exécutables avec la capacité déclarée, puis attribuer ou préparer les tâches autorisées. Ne pas convertir une tâche créée en travail déjà commencé.
- **Hebdomadaire :** comparer le travail engagé et livré, les retouches, la capacité disponible et les décisions client. Sourcer chaque résultat et sa période. Proposer arbitrage de périmètre ou report lorsqu'une charge dépasse la capacité ; ne pas promettre une date ni un résultat commercial sans accord et preuve.

Écrire les mises à jour métier via les outils disponibles et relire les identifiants retournés. Le rapport reste une vue, pas un second CRM. Le cockpit n'offre pas de pipeline de prospects individuels : une liste de prospection reste un livrable privé rattaché au client et à sa campagne.

Terminer avec les décisions prises, les tâches effectivement persistées, les imports encore manquants et la prochaine revue si sa cadence est déjà autorisée. Aucun cron, recrutement ni message externe n'est créé par la simple lecture de ce skill. Voir `Processes/Portfolio review.md` dans le pack installé.
