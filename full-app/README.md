# LeadFactory — logiciel complet, starter privé

Cette application reprend le logiciel interne **`gquthier/leadfactory-app`**, révision **`e909784b7a28982825b3a1b4d7ee0ff8b27e9bf1`** : dashboard, recrutement et gestion de l’équipe, clients, onboarding, campagnes, CRM, résultats, finances, ressources, formations et outils créatifs. La copie a été préparée pour fonctionner localement sans les données ni les connexions de l’agence d’origine. Lecture et préparation : **1er octobre 2026**.

Stack : **Next.js 15.5.27**, React et TypeScript, Node.js 22 ou plus récent. Le dossier doit rester dans le pack parent : les agents, les skills et l’adaptateur CLI sont chargés depuis les dossiers voisins de `full-app`.

Voir également la [revue de confidentialité et des accès clients](CONFIDENTIALITY.md), qui précise les corrections et les limites de la première vérification.

## Démarrer

Depuis la racine du pack :

```sh
cd full-app
npm ci
npm run dev
```

Ouvrir **http://127.0.0.1:14320/admin/start-here**. Aucun fichier `.env` ni compte fournisseur n’est nécessaire pour découvrir les écrans. Le [Start Here complet](docs/START-HERE.md) explique chaque connexion.

La base locale JSON démarre vide, hormis un **administrateur fictif** qui permet de parcourir le logiciel. Elle est conservée dans `.local-data/db.json`, exclu de Git. Créer ses propres fiches de démonstration ; aucune fiche client, liste de prospects, formation privée, campagne historique ou preuve de résultats n’est préchargée. Les vues client sont des aperçus locaux, pas des sessions de clients authentifiés.

## Agents et connexions

Dans **Start Here → IA personnelle**, choisir **Codex CLI**, **Claude Code CLI** ou OpenRouter. Pour un CLI déjà connecté sur cette machine, aucune clé API à saisir : cliquer **Vérifier et connecter mon IA**. L’adaptateur du pack parent est directement appelé par ce logiciel. Le fournisseur traite les textes ; exécution locale ne signifie pas IA hors ligne.

Dans **Agents**, recruter les rôles, choisir le client, ajouter les sources autorisées et lancer une mission de rédaction. Les huit templates de rôles sont inclus. L’option explicite d’automatisation du Start Here déclenche après un onboarding terminé **Onboarding → Creative Strategist → Media Buyer → Communication client**, quatre exécutions maximum. La proposition est enregistrée pour relecture ; elle n’envoie aucun message et ne lance aucune campagne. L’ordinateur et le serveur doivent rester ouverts.

Les tokens personnels Slack, Meta, ElevenLabs et OpenRouter se saisissent dans **Mes connexions personnelles**. Ils sont conservés côté serveur dans `.local-data/integrations.json`, avec permissions **0600**, jamais renvoyés dans les réponses de lecture du cockpit et exclus de Git. Ils ne sont pas chiffrés au repos : la protection du compte système et du disque reste nécessaire. **Tester l’accès en lecture** vérifie uniquement l’identité ou l’accès au compte : aucun message Slack, aucune campagne Meta ni génération vocale. Une réussite ne prouve pas les permissions métier.

## SQL fourni, sans connexion

Le [schéma SQL](database/schema.sql) contient **50 tables**, sans données métier, compte ni secret. Il peut aussi être téléchargé dans l’interface via **`/api/starter/schema`**. Aucune base existante n’est consultée ou connectée. L’importation reste manuelle, dans un **projet Supabase personnel vide**, selon le [guide base de données](database/README.md).

Le mode distant est distinct. Il nécessite ensemble `LEADFACTORY_DATA_MODE=supabase`, `LEADFACTORY_CONNECT_DATABASE=1`, `NEXT_PUBLIC_LEADFACTORY_DATA_MODE=supabase` et les clés de son propre projet. Les anciennes API externes demandent aussi `LEADFACTORY_ENABLE_EXTERNAL=1`. Le fichier [env.example](env.example) laisse tous les secrets vides et les modes locaux par défaut. Le moteur d’agents et ses connexions Start Here restent locaux ; ils ne sont pas synchronisés automatiquement vers le schéma distant.

## Périmètre réel

Ce mode est un **atelier administratif local**, lié à l’interface loopback `127.0.0.1:14320`, avec identité locale fictive. **Ne pas le publier derrière un tunnel ou un proxy public.** Son mode local n’est pas une authentification de production.

Le code des anciens adaptateurs est fourni pour configuration et recette ultérieures ; leur présence ne prouve pas qu’ils sont prêts avec un compte tiers. Le SQL applique des accès RLS plus stricts que l’historique : certaines anciennes requêtes, notamment les sélections larges de profils, nécessitent une adaptation. Le mode Supabase et le déploiement public ne sont **pas certifiés pour la production** ; recetter Auth, droits serveur, RLS, Storage et séparation client sur sa propre installation avant tout usage réel.

Aucune connexion, synchronisation, campagne, publication, email, cron ou agent permanent n’est activé par l’installation. Les vérifications de compte et les missions IA demandent une action ou une option explicite de l’utilisateur.

## Vérifier le code

```sh
npm run typecheck
npm test
npm run build
```

Ces commandes ne certifient pas les connexions fournisseur. Les tests et leurs limites se lisent avec le compte rendu de livraison. Pour les droits sur cette copie et les dépendances, voir [NOTICE.md](NOTICE.md) : le caractère privé est conservé et la licence du pack parent n’est pas automatiquement celle du logiciel interne.
