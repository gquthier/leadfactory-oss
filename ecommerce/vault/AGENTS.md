# Comment ce business fonctionne

Lire dans cet ordre : `Start here.md`, `Business.md`, `Rules.md`, `Autonomy.md`, `Team.md`,
`Source map.md`. Puis votre fiche de rôle, puis le seul produit ou la seule étape concernés
par la tâche en cours. Ne pas charger l'ensemble du coffre pour une tâche ponctuelle.

Ce dossier est un espace de travail vide et réutilisable. Compléter les faits manquants
depuis le brief du propriétaire et des sources vérifiables. Ne jamais importer la marque, les
produits, les prix, les fournisseurs, les créatives ou les résultats d'un autre business.

## Une tâche

Identifier l'étape (`Source map.md`) et le produit concerné, lire le processus correspondant
dans `Processes/`, produire le livrable demandé, enregistrer les sources et ce qui manque,
puis passer la main au rôle suivant selon `Processes/Handoffs.md`.

Une fiche de rôle est une spécification. Un agent existe seulement quand l'exécution en cours
en a réellement créé un. Un passage de relais n'est effectué que si un message ou une tâche a
réellement été enregistré ; sinon il est écrit comme en attente.

## Enregistrer le travail

Quand les outils `commerce_*` sont disponibles, ils sont la source de vérité :

- `commerce_schema` avant toute écriture : les champs, les valeurs autorisées et les étapes
  viennent du serveur. Ne pas deviner une signature.
- `commerce_records` pour lister, lire, créer et mettre à jour produits, concurrents,
  fournisseurs, boutiques, créatives, campagnes, tâches, livrables et relevés.
- `commerce_profile_update` pour le profil du business (nom, niche, marché, devise, étape).
- `commerce_dashboard` pour adapter le cockpit : titre, introduction, sections, checklists.
  La configuration est déclarative ; elle n'exécute aucun code.
- `commerce_list_skills`, `commerce_read_skill` pour lire une procédure du pack,
  `commerce_read_document` pour lire une note de ce coffre.

Ne jamais écrire directement dans les fichiers de base ou de verrou du cockpit. Sans ces
outils, produire le livrable dans le dossier autorisé et nommer l'import restant à faire.

## Distinguer ce qui est observé de ce qui est supposé

Une publicité concurrente active, un nombre d'impressions ou une estimation de trafic sont
des **observations datées**. Ce ne sont pas des ventes, ni une preuve de rentabilité. Écrire
la source et la date dans le champ prévu, et garder l'interprétation à part.

Ne jamais rédiger d'avis client, de témoignage ou de résultat qui n'a pas eu lieu. Un chiffre
non mesuré reste inconnu, jamais zéro.

Voir `Autonomy.md` pour les actions qui exigent l'accord du propriétaire. Lire ce dossier
n'active aucun compte, aucune routine et aucun envoi.
