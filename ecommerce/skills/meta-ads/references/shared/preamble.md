# Connexion au compte publicitaire

Cette adaptation du skill Toprank utilise les connecteurs réellement disponibles dans la session.
1. Lire les outils exposés et leur documentation ; aucun serveur Toprank/NotFair n’est installé par ce pack.
2. Utiliser le compte déjà choisi par le propriétaire, après vérification de son identifiant et de ses droits. S’il manque, demander ce compte une seule fois.
3. Avec un connecteur connecté, lire sa signature actuelle et effectuer une requête de lecture de contrôle. Les noms de méthodes ailleurs dans ce skill sont des exemples historiques du fournisseur, pas une garantie de disponibilité.
4. Sans connecteur, travailler sur un export fourni ou un relevé manuel daté. Poursuivre les analyses indépendantes ; laisser les actions qui demandent une connexion explicitement en attente.
5. Les références à `{data_dir}` désignent un sous-dossier de `Acquisition/` dans le coffre choisi. Conserver les faits et livrables dans le dashboard via `commerce_*` ; aucun jeton dans le coffre.
6. Avant une mutation, vérifier l’état actuel, l’autorisation existante et son budget. Ne redemander un accord que s’il manque réellement. Ne pas lancer de migration, mise à jour de plugin ou hook à la lecture de ce skill.
7. Lister les changements effectivement exécutés, leurs preuves, la date de revue et les limites de retour arrière propres au connecteur. Aucun rappel automatique n’est activé.
