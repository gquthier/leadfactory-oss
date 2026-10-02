# Démo complète de l’agence

Lecture et préparation : **1er octobre 2026**. Statut : parcours autonome local ; mise en ligne préparée, non exécutée. Le dépôt reste privé.

## Lancer et filmer

Node.js 22 ou plus, aucun package supplémentaire pour le cockpit :

```sh
npm run demo
```

Cockpit : `http://127.0.0.1:4310`. Portail : port 4311, à ouvrir par le lien créé dans le dossier client. Base distincte : `data/demo/db.json`. Si un port est occupé : `PORT=14310 PORTAL_PORT=14311 npm run demo`. Conserver ce processus ouvert pendant la démo.

1. **Créer le client fictif** dans Clients. Ouvrir son dossier. Expliquer ce que l’agence doit livrer.
2. **Créer le lien** dans « Lien client → proposition de campagne ». Choisir démo sans IA pour une démonstration reproductible ; choisir IA avec une connexion personnelle configurée pour montrer les vrais appels. Connecter d’abord Claude Code ou Codex dans Start Here, sans clé API. Ce choix autorise au plus quatre exécutions ; [limites et connexion CLI](PERSONAL-CLI.md).
3. **Ouvrir le lien client** dans un autre onglet/profil. Cinq étapes : entreprise, offre, cible, campagne, livraison. Saisir budget, lead qualifié, KPI, preuves et contraintes. Le brouillon se sauvegarde et reprend sur le même lien.
4. **Terminer l’onboarding**. Les réponses, le brief, la campagne brouillon, les tâches et une mission sont enregistrés ensemble. Deux clics ne lancent pas deux missions.
5. **Revenir au cockpit**, actualiser le suivi. Montrer Onboarding → Creative Strategist → Media Buyer → Communication client. Chaque étape conserve son texte, son statut, le modèle et l’usage renvoyés en IA. La démo sans IA est identifiée comme modèle prérempli.
6. **Relire la proposition** dans les étapes ou dans Livrables. Huit parties : objectif, cible, concept, budget, production, mesure, viabilité et validation. Modifier le livrable dans le cockpit si nécessaire, puis « Partager la proposition relue au client ».
7. **Retourner sur le lien client** : la proposition partagée apparaît. Le partage n’est pas une signature. Aucun email, achat média ou rendu vidéo n’a été lancé.
8. **Montrer le prochain livrable créatif** : ouvrir le skill motion Meta 9:16. Site/brand → script → ElevenLabs → animation → recette. Opus 5.5 recommandé ; les fichiers vidéo n’existent qu’après un vrai rendu.

Pour rejouer : créer un nouveau client fictif ou un nouveau lien après fin/arrêt de la mission. Le nouveau lien révoque l’ancien. Aucun reset automatique ou suppression des dossiers existants.

Le [template JSON du formulaire](../templates/onboarding-form.json) est généré depuis le même schéma que les deux interfaces. Modifier `lib/onboarding.mjs`, puis `npm run templates:build` pour le maintenir.

## Base et autonomie réelles

Le cockpit et le portail partagent **la même base JSON durable**, avec verrou exclusif, file d’écritures et renommage atomique. Il n’y a pas de synchronisation distante cachée ni de Supabase nécessaire. Les invitations et exécutions restent dans cette base locale ; l’export métier retire l’autorité des liens et les jobs. Un import invalide les liens et refuse de remplacer une base pendant un run actif.

Chaque lien est aléatoire, conservé sous empreinte serveur, valable 7 jours, limité à un client et une soumission. La valeur est dans le fragment du navigateur puis dans un header d’autorisation, pas dans une URL de requête. Ce lien est une capacité d’accès : le partager seulement au destinataire voulu. Créer un nouveau lien révoque le précédent. Le portail ne fournit aucune route d’administration.

En **mode IA**, le runner exécute quatre rôles de rédaction avec leurs vrais prompts et un skill central par étape ; il ne crée pas quatre conversations BizOS ni des agents avec accès libre aux outils. Il lit seulement le questionnaire de ce client et les outputs précédents. Le CLI et le modèle demandé sont ceux choisis à la création du lien ; pas de fallback factice en cas d’échec. Erreurs conservées, STOP disponible, reprise d’une requête interrompue désactivée pour éviter la double facturation. Les jobs encore en attente reprennent au redémarrage. Pas de cron ajouté au Mac.

En **mode démo**, les mêmes transitions utilisent des documents déterministes et n’appellent aucun modèle. Les traces ne doivent pas être présentées dans une vidéo comme une performance d’IA réelle.

## Adresse Internet avec dépôt privé

Le code est prêt pour un hôte personnel et un domaine configuré. Aucune adresse Internet n’a été déployée dans cette session, faute de destination choisie. Le dépôt peut rester privé : seul le portail client est servi.

Les fichiers `deploy/compose.yaml`, `deploy/Dockerfile` et `deploy/Caddyfile` donnent une configuration Node + HTTPS + volume persistant. Sur votre serveur, avec Docker Compose, ports 80/443 disponibles et DNS du domaine pointant vers ce serveur :

```sh
PORTAL_DOMAIN=onboarding.votre-domaine.fr docker compose -f deploy/compose.yaml up -d --build
```

Le proxy HTTPS ne dessert que le listener portail 4311. L’administration 4310 est liée à la loopback de l’hôte ; y accéder localement ou par tunnel SSH autorisé. Ne pas publier le port d’administration sur Internet. Le conteneur Node tourne sans root. Sauvegarder le volume complet séparément des exports métier si les liens et historiques doivent être conservés. La recette Docker/TLS distante reste à faire sur la machine cible ; la configuration n’est pas présentée comme un déploiement vérifié.

Pour un reverse proxy déjà disponible, garder l’admin en loopback et configurer `PORTAL_HOST`, `PORTAL_PORT`, `PORTAL_ORIGIN=https://…`. Préserver le Host du domaine ; le portail refuse les autres hosts et les écritures cross-origin. Hébergement permanent, DNS et facturation dépendent de l’environnement choisi.

## Validation et limites

Parcours navigateur réalisé avec données fictives, formulaire cinq étapes, déclenchement unique, partage et lecture de proposition. Les tests couvrent droits des liens, doubles soumissions, erreurs fournisseur, STOP, redémarrage, import et refus d’une proposition dont le brief a changé. L’API IA est testée avec un transport simulé : aucun appel modèle dans cette recette simulée. Une vérification réelle Codex distincte est décrite dans [la recette CLI](PERSONAL-CLI.md). Le helper ElevenLabs est testé synthétiquement ; aucun audio fournisseur ni nouvelle vidéo rendu ici.

Cette extension ne change pas le BizOS Simple installé. Elle est livrée dans le pack autonome ; ses prompts, skills et assets web sont aussi inclus dans les ressources de l’intégration source, sans prétendre que le portail écoute automatiquement dans l’app actuelle.

## Rejouer la recette

`npm test`, `npm run test:outbound`, `npm run test:voice`, puis `node test-e2e/onboarding.mjs` avec Playwright installé séparément (ou `PLAYWRIGHT_MODULE` pointant vers son module). Ce scénario démarre deux listeners temporaires, utilise une base fictive isolée, filme les captures dans `E2E_OUTPUT` ou un dossier temporaire et ferme ses serveurs. Il ne demande aucune clé.
