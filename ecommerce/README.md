# E-commerce dans BizOS local

Un template réutilisable pour passer de la recherche produit à une boutique testée, puis organiser les créatives, l'acquisition et les opérations : dashboard métier, six rôles source, dossiers et 24 skills.

## Dans BizOS

Le runtime conserve l'identifiant `ecommerce` pour les installations existantes et l'installation du pack métier. Il ne fait plus partie des quatre choix de création initiaux actuels. Dans un espace E-commerce installé, le choix reste attaché au coffre local : le dashboard Apps, les outils agents et les dossiers partagent la même base. Cette documentation source ne certifie pas le contenu d'un binaire installé.

Dans **Start Here**, renseignez votre activité. Connectez votre modèle personnel dans les réglages de BizOS, puis ouvrez l'équipe E-commerce dans Discussions. Première mission possible : « Recherche trois pistes de produits pour ce marché, cite tes sources et tes hypothèses, puis enregistre les dossiers et les prochaines tâches. »

Les dossiers `Products/` contiennent les vues lisibles des fiches. Les méthodes, rôles et skills sont installés dans le coffre ; vous pouvez les personnaliser. Les enregistrements métier s'éditent depuis le dashboard ou ses outils agents.

## Dashboard autonome en local

Node.js 22 ou plus récent. Depuis le dépôt cloné :

```sh
cd ecommerce
npm start
```

Ouvrez **http://127.0.0.1:4320**. Aucune dépendance n'est nécessaire. La base démarre vide et reste dans `ecommerce/data/`, exclu de Git. Export/import JSON sont disponibles dans Start Here. Ce mode gère vos fiches mais ne crée pas les agents BizOS.

Autre dossier ou port :

```sh
DATA_DIR=/chemin/vers/mes-donnees PORT=4321 npm start
```

Pour un autre assistant, depuis la racine du dépôt :

```sh
node scripts/install-skills.mjs --pack ecommerce --target ~/.codex/skills
# Ou --target ~/.claude/skills pour Claude Code
```

L’installateur conserve les licences et refuse les collisions. Fournissez-lui le dossier `vault/` comme contexte de projet. Ne remplacez pas un skill ou un contexte existant sans examiner la différence.

## Parcours et connexions

Le parcours couvre recherche, concurrents/ads, sourcing et coûts, offre, marque, Shopify, créatives, acquisition, rétention et opérations. Les comptes Shopify, publicité, email et médias sont les vôtres. L'agent vérifie les outils disponibles et vous indique les accès à connecter au moment utile. Les skills ne fournissent pas ces comptes.

Dans BizOS cloud/SaaS, ces méthodes passent uniquement par les outils du broker autorisé ; elles ne demandent ni ne recherchent les clés de la plateforme. Le cockpit autonome et les connexions BYOK du propriétaire forment un autre contexte. Les exports distribuables sont des sources vides, jamais une copie du coffre ou de `data/` d'un utilisateur.

Pour la boutique, les skills utilisent les [instructions officielles Shopify pour créer et prévisualiser un thème](https://shopify.dev/docs/storefronts/themes/getting-started/create), puis les contrôles du catalogue, du panier et du checkout. Une boutique en aperçu et une campagne préparée ont des statuts distincts de leur publication réelle. La QA utilise d'abord les modes test appropriés.

Les métriques du dashboard sont saisies par vous ou transcrites par un agent à partir de sources identifiées ; elles ne sont pas synchronisées automatiquement avec les plateformes. Les médias sont livrés seulement lorsqu'un fichier a réellement été produit et contrôlé.

## Vérification et origine

```sh
npm test
```

Voir le [parcours](vault/Source%20map.md), l'[exemple fictif complet](skills/ecommerce-orchestrator/references/worked-example.md) et les [notices des skills](THIRD_PARTY_NOTICES.md). Le pack contient des procédures originales et des skills MIT adaptés de notre bibliothèque existante ; les transcripts de formation et les contextes privés ne sont pas distribués.
