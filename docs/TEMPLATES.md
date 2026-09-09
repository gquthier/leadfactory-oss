# Contrat des templates métier locaux

Les templates Agency et E-commerce partagent ces règles. Toute nouvelle template métier doit les conserver.

1. **Choix initial.** L’utilisateur choisit le business model et son coffre avant l’installation. Le serveur résout un identifiant de dossier autorisé ; le formulaire ne transmet pas de chemin arbitraire.
2. **Un coffre fixe.** La liaison est persistée avant les premiers fichiers ou agents. La même installation peut reprendre après interruption ; un autre template ou coffre est refusé dans cet espace. La navigation ordinaire n’offre pas de sélecteur pour changer de coffre.
3. **Tout le travail y est visible.** Les dossiers des agents, processus et skills sont dans le coffre. Les données métier vivent dans `Apps/<modèle>/data/`. Les dossiers clients ou produits présentent des vues Markdown de cette base ; les notes humaines restent à côté et sont préservées.
4. **Dashboard dans Apps.** Le dashboard s’affiche directement dans la page du template. Une section Start Here guide le profil, la connexion du modèle et la première mission. La version autonome sert au lancement local séparé, pas de deuxième base cachée dans BizOS.
5. **Même donnée pour l’humain et l’agent.** Les formulaires et les outils métier partagent la base. Les modifications arrivent dans le dashboard sans rechargement manuel, en préservant les brouillons. Les agents lisent les skills installés dans le coffre, y compris les adaptations de son propriétaire.
6. **Dashboard personnalisable.** Les agents modifient une configuration validée — titres, sections et checklists prévues par le modèle. Les champs de données ne deviennent pas du JavaScript ou du HTML exécuté.
7. **Installation réutilisable.** Une réinstallation ajoute les fichiers manquants sans remplacer les notes éditées. Elle réutilise les agents et leur équipe. Un coffre manquant ou remplacé par un lien produit une erreur ; l’app n’en crée pas silencieusement un autre.
8. **Comptes du propriétaire.** Les connexions modèles, boutique, publicité, email et médias sont fournies par l’utilisateur. Aucun compte, routine, publication ou budget externe n’est activé par le seul choix du template.

## Structure

```text
Mon coffre/
  Start here.md
  Business.md
  Agents/
  Processes/
  skills/
  Apps/
    LeadFactory/data/     # template agence
    # ou Ecommerce/data/  # template e-commerce
  Clients/               # agence : dossiers générés et notes humaines
  # ou Products/          # e-commerce
```

Chaque espace ne reçoit que les dossiers de son modèle. L’export JSON sauvegarde les fiches métier ; une sauvegarde de l’ensemble du coffre conserve aussi les notes et skills personnalisés. Les connexions personnelles de BizOS ne sont pas incluses dans cet export.

## Ajouter un modèle

Fournir le manifest du template, les notes, les rôles, les skills avec licences, le dashboard et son schéma. L’enregistrer dans le catalogue du runtime et les routes métier, puis dans la liste des dashboards acceptés par le desktop. Réutiliser le service de liaison et le composant d’affichage intégré.

Vérifier sur un espace vide puis après redémarrage : choix unique, reprise sans duplication, édition humaine et agent dans la même base, visibilité dans les dossiers, préservation des notes, refus d’un autre coffre, refus des chemins non autorisés et arrêt immédiat des outils après STOP.

## Plusieurs OS pour un administrateur local

Complément du 9 septembre 2026 : un administrateur peut posséder plusieurs OS, regroupés en organisations locales. Le sélecteur Entreprises de la sidebar crée ou ouvre un OS. Chaque OS a un état de runtime, un profil desktop et une liaison coffre/template distincts. Changer d’OS ne change pas le coffre de l’OS quitté. L’ouverture utilise une relance du profil et refuse une transition pendant un run actif. Les organisations locales ne sont pas des organisations cloud ni un mécanisme de partage entre utilisateurs.
