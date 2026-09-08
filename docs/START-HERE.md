# Start Here

Commencez par votre agence, puis un premier client. La gestion du cockpit et les modèles préremplis fonctionnent sans compte IA.

## 1. Votre agence

Dans **Start Here**, renseignez votre nom d’agence, offre, cible, langue et contact. Créez ensuite votre premier client, ou demandez à un agent de le faire si vous utilisez BizOS local.

## 2. Votre IA personnelle

### Dans BizOS local

L’agence s’installe depuis **Apps → Agence LeadFactory → Installer** : six agents, leur équipe, les 23 skills et un vault dédié sont créés. Ouvrez le cockpit depuis cette fiche pour travailler sur les données partagées avec les agents.

Configurez le modèle dans les **réglages BizOS**, avec votre propre abonnement ou connexion **Codex, Claude ou Cursor**, selon le fournisseur disponible. **Start Here** vous oriente vers ces réglages ; il ne demande pas de connexion OpenRouter pour utiliser les agents BizOS.

Dans **Discussions**, demandez à **Agency Director** : « Prépare le dossier de ce nouveau client et son onboarding. Enregistre son brief, sa campagne brouillon et les prochaines tâches dans le cockpit. » Les agents travaillent avec le modèle et les outils que vous avez configurés.

### Avec le cockpit autonome

Lancez `npm start` à la racine du clone. Vous pouvez travailler avec les modèles préremplis ou exporter un dossier client vers votre assistant.

Pour rédiger directement depuis ce cockpit, configurez facultativement votre propre clé **OpenRouter** et un identifiant de modèle dans **Start Here**. Le bouton de test vérifie la clé ; l’accès au modèle dépend aussi de votre compte et de vos crédits. **Rédiger avec mon IA** transmet le contexte du client et de la campagne sélectionnés au fournisseur, puis enregistre un livrable texte à relire.

La connexion est stockée localement et séparément des dossiers clients. Elle n’est pas incluse dans les exports métier : reconfigurez-la sur une autre machine après restauration.

## 3. Vos skills et outils

Dans BizOS, les **23 skills** sont inclus dans l’installation de l’agence. En mode autonome, installez-les dans votre assistant avec les commandes du [README](../README.md), puis fournissez-lui le dossier Markdown du client. Le [catalogue](SKILLS.md) décrit chaque méthode et ses dépendances.

Le cold email, Meta Ads et la génération d’images ou de vidéos utilisent **vos propres comptes**, leurs crédits et les outils que vous connectez à votre environnement. Aucune routine ni action externe n’est activée par défaut. Les abonnements des assistants et services restent ceux de l’utilisateur.

## 4. Le premier onboarding

Créez un client, ouvrez son questionnaire et complétez les étapes métier. Le brouillon peut être sauvegardé puis repris. La soumission exige les informations essentielles ; elle prépare une campagne en brouillon, une checklist et un brief.

Relisez le brief avec le client et marquez-le revu lorsque cette revue a eu lieu. Une modification de fond nécessite une nouvelle validation. Le formulaire s’utilise localement par l’opérateur, seul ou avec le client ; il ne fournit pas de lien d’onboarding public distant.

Dans BizOS, les agents peuvent aussi gérer les étapes d’onboarding avec leurs outils d’agence. Leurs modifications apparaissent dans le même dossier que celui ouvert dans le cockpit.

## 5. Le premier livrable

Dans BizOS, confiez une mission précise à un agent : client, objectif, preuves disponibles et livrable attendu. Demandez-lui d’enregistrer son résultat dans le dossier client du cockpit. En mode autonome, choisissez un modèle prérempli, une rédaction OpenRouter ou un skill exécuté par votre assistant.

Le cockpit recherche les nouvelles données toutes les **trois secondes**. Si vous rédigez ou avez un brouillon non enregistré, il conserve votre saisie et signale les changements ; enregistrez votre travail avant d’appliquer la mise à jour.

Relisez le résultat et enregistrez vos modifications. Pour une image ou une vidéo, liez le fichier réellement produit par l’outil utilisé : une idée ou un prompt reste une étape de préparation. Les envois aux prospects, publications et lancements publicitaires suivent ensuite vos instructions et autorisations.
