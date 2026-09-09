# LeadFactory Open Agency

Le kit open source pour monter et opérer une agence de génération de leads : **23 skills, méthodes métier, second cerveau, équipe d’agents et logiciel de gestion local**. Vous le personnalisez avec votre offre, vos clients et vos comptes.

Le second template **[E-commerce](ecommerce/README.md)** ajoute 24 skills, six rôles et un dashboard pour les produits, boutiques et opérations. Les deux templates suivent le [même contrat d’intégration dans BizOS local](docs/TEMPLATES.md).

## Choisir votre démarrage

| Mode | Ce que vous utilisez | Démarrage |
|---|---|---|
| Cockpit autonome | Gestion locale des clients, campagnes, tâches, onboarding et livrables ; assistant au choix | Clonez le dépôt et lancez `npm start` |
| Template dans BizOS local | Six agents, leur équipe, les skills et le dashboard intégré | **Apps → Agence ou E-commerce → choisir un coffre** |
| E-commerce autonome | Produits, concurrents, fournisseurs, boutiques, créatives et opérations | `cd ecommerce && npm start` |

La [preview BizOS pour Mac Apple Silicon](https://github.com/gquthier/leadfactory-oss/releases/tag/v0.3.0-preview.1) inclut les deux templates, avec leurs dashboards intégrés et les sources desktop correspondantes. Des missions avec un vrai agent Claude ont vérifié la lecture de skills et les écritures partagées : dossier client pour Agency, produit, livrable et titre du dashboard pour E-commerce. Cette preview locale est signée ad hoc, non notarisée. Le [guide BizOS](docs/BIZOS.md) explique l’installation et la compilation.

## Démarrer le cockpit autonome

Prérequis : [Node.js 22 ou plus récent](https://nodejs.org/).

[Créer votre copie avec « Use this template »](https://github.com/gquthier/leadfactory-oss/generate), ou cloner directement :

```sh
git clone https://github.com/gquthier/leadfactory-oss.git
cd leadfactory-oss
npm start
```

Ouvrez **http://127.0.0.1:4310**. Le cockpit autonome ne demande aucune dépendance à installer ni compte pour gérer votre agence. Sur macOS, `start.command` permet aussi de le lancer après installation de Node.js.

Il démarre vide ; la démo facultative est fictive. Vos données restent dans `data/`, exclu de Git. Ce mode est destiné à un utilisateur sur son ordinateur. Il ne crée pas les agents BizOS.

## Utiliser l’agence dans BizOS local

1. Dans **Apps**, choisissez **Agence LeadFactory** ou **E-commerce**, puis un nouveau coffre ou un dossier déjà partagé avec BizOS. Le choix reste fixe pour cet espace. BizOS y installe les notes, processus, skills, six agents et leur équipe.
2. Le dashboard métier s’affiche directement dans Apps. Les agents et les formulaires utilisent la même base : clients et onboarding pour l’agence, produits et boutiques pour l’e-commerce.
3. Dans les réglages, connectez votre modèle personnel. Complétez **Start Here**, puis confiez une mission au directeur de l’équipe dans Discussions.

Dans **Second cerveau → Dossier**, vous retrouvez les rôles, processus, `skills/` et les dossiers métier. Les skills locaux sont modifiables ; leur réinstallation préserve vos éditions. Les agents peuvent adapter le titre, les sections et les checklists autorisées du dashboard.

Les modifications des agents sont recherchées toutes les trois secondes par le cockpit. Si vous êtes en train de rédiger ou avez un brouillon non enregistré, il le conserve et signale les nouvelles données.

Aucune routine n’est activée par défaut. Les comptes de cold email, de publicité et de génération d’images ou de vidéos sont les vôtres ; les actions externes ne partent pas automatiquement à l’installation.

## Ce qui est inclus

| Brique | Utilisation |
|---|---|
| Cockpit | Clients, campagnes, tâches, questionnaire d’onboarding et livrables texte |
| 23 skills métier | 21 méthodes adaptées du pack public, plus définition d’offre et relation client après livraison |
| Parcours d’agence | De l’offre au reporting client : [guide](docs/AGENCY-PLAYBOOK.md) |
| Second cerveau | Notes et processus personnalisables dans [vault](vault/) |
| Équipe BizOS locale | Agency Director, Acquisition, Onboarding, Strategist, Creative et Account Manager |
| Portabilité | Export/import JSON et dossier client Markdown |
| Sources du runtime | Intégration locale sous [integrations/bizos-local/runtime](integrations/bizos-local/runtime/) |

Les modèles préremplis du cockpit fonctionnent sans IA. En mode autonome, **Rédiger avec mon IA** utilise votre connexion OpenRouter pour produire du texte ; dans BizOS, les agents utilisent le modèle personnel configuré dans l’application. Les skills guident l’assistant et ses outils disponibles. Une image ou une vidéo est livrée lorsque le fichier a réellement été produit par le service choisi.

## Installer les skills dans un autre assistant

L’installation Agency dans BizOS inclut déjà les 23 skills ; E-commerce en inclut 24. Pour le mode autonome avec votre propre assistant :

```sh
node scripts/install-skills.mjs --target ~/.codex/skills
# Pour le pack E-commerce :
node scripts/install-skills.mjs --pack ecommerce --target ~/.codex/skills
# Ou, pour Claude Code :
node scripts/install-skills.mjs --target ~/.claude/skills
```

L’installateur refuse d’écraser un skill existant. Le [catalogue](docs/SKILLS.md) détaille les entrées, sorties et outils nécessaires.

## Votre premier client

Suivez [Start Here](docs/START-HERE.md) : renseignez l’agence, créez un client et complétez son onboarding. La soumission prépare une campagne brouillon, une checklist et un brief.

Dans BizOS, demandez par exemple : « Crée le dossier de ce client, prépare son onboarding et enregistre le brief et les prochaines tâches dans le cockpit. » En mode autonome, exportez le dossier Markdown et fournissez-le à votre assistant avec le skill adapté. Relisez les livrables avant leur utilisation commerciale.

## Vérification et contribution

Cockpit autonome :

```sh
npm test
```

Runtime BizOS : commandes dans [docs/BIZOS.md](docs/BIZOS.md). Voir aussi [CONTRIBUTING](CONTRIBUTING.md). Utilisez des fixtures fictives et gardez vos données clients et connexions hors des contributions.

## Licence et origine

Le kit, son cockpit et ses documents originaux sont sous **MIT**. Les 21 skills adaptés viennent de [tarsluna/my-custom-skills](https://github.com/tarsluna/my-custom-skills). Le runtime intégré sous `integrations/bizos-local/runtime/` est sous **AGPL-3.0-only**, avec ses attributions amont conservées. Les détails et textes de licence sont référencés dans [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).

Le logiciel de gestion du kit a été réécrit ; les dossiers clients et l’historique de l’ancien logiciel privé de LeadFactory ne sont pas redistribués.
