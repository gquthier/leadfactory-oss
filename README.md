# LeadFactory Open Agency

Le kit open source pour monter et opérer une agence de génération de leads : **26 skills, méthodes métier, second cerveau, équipe d’agents et logiciel de gestion local**. Vous le personnalisez avec votre offre, vos clients et vos comptes.

Le second template **[E-commerce](ecommerce/README.md)** ajoute 24 skills, six rôles et un dashboard pour les produits, boutiques et opérations. Les deux templates suivent le [même contrat d’intégration dans BizOS local](docs/TEMPLATES.md).

**Utilisation recommandée : [BizOS](https://bizos.cc)**, avec ses templates natifs et ses agents conçus dès le départ pour ce business model. Les méthodes, rôles et skills restent lisibles, modifiables et duplicables sous leurs licences : aucun verrou anti-copie.

**Préversion privée — 26 septembre 2026.** Les sources sont préparées pour une distribution open source, mais ce dépôt GitHub reste privé. Son clonage et ses téléchargements nécessitent un compte autorisé. Le [catalogue privé commun](https://github.com/gquthier/bizos-templates) réunit les cinq packs ; il ne constitue pas un nouveau mécanisme d'installation à distance dans l'app.

## Choisir votre démarrage

| Mode | Ce que vous utilisez | Démarrage |
|---|---|---|
| Cockpit autonome | Gestion locale des clients, campagnes, tâches, onboarding et livrables ; assistant au choix | Clonez le dépôt et lancez `npm start` |
| Template dans BizOS local | Un CEO, des spécialistes recrutés à la demande, les skills et le dashboard intégré | **Apps → choisir un template et un coffre** |
| E-commerce autonome | Produits, concurrents, fournisseurs, boutiques, créatives et opérations | `cd ecommerce && npm start` |

La [preview historique du 9 septembre 2026 pour Mac Apple Silicon](https://github.com/gquthier/leadfactory-oss/releases/tag/v0.3.0-preview.2) inclut les deux templates, avec leurs dashboards intégrés et les sources desktop correspondantes. Des missions avec un vrai agent Claude ont vérifié la lecture de skills et les écritures partagées : dossier client pour Agency, produit, livrable et titre du dashboard pour E-commerce. Ces preuves concernent la version du 9 septembre ; elles ne certifient pas le présent pack enrichi ni son installation dans l’app actuelle. Cette preview locale était signée ad hoc, non notarisée. Le [guide BizOS](docs/BIZOS.md) explique l’installation et la compilation.

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

1. Une nouvelle entreprise propose **Lead Gen Agency**, **Service-based Business**, **Software**, **E-commerce** ou **Company OS** (entreprise autonome générique). Choisissez un nouveau coffre ou un dossier déjà partagé avec BizOS ; ce choix reste fixe. Le modèle installe ses notes, processus et uniquement **CEO**, avec sa conversation. Les spécialistes restent dans `Roles/` jusqu’à un recrutement utile à une mission. Les anciens espaces et les équipes déjà installées restent disponibles.
2. Le dashboard métier s’affiche directement dans Apps. Les agents et les formulaires utilisent la même base : clients et onboarding pour l’agence, produits et boutiques pour l’e-commerce.
3. Dans les réglages, connectez votre modèle personnel. Complétez **Start Here**, puis confiez une mission au CEO dans Discussions. Lorsqu’elle le justifie, le CEO recrute un spécialiste, lui crée ou réutilise une équipe persistante et lui envoie une vraie première tâche.

Dans **Second cerveau → Dossier**, vous retrouvez les rôles, processus, `skills/` et les dossiers métier. Les skills locaux sont modifiables ; leur réinstallation préserve vos éditions. Les agents peuvent adapter le titre, les sections et les checklists autorisées du dashboard.

Les modifications des agents sont recherchées toutes les trois secondes par le cockpit. Si vous êtes en train de rédiger ou avez un brouillon non enregistré, il le conserve et signale les nouvelles données.

Le démarrage **guidé**, utilisé par défaut, n’active aucune routine. Le choix explicite **Full autonomous** à la création installe une seule routine locale quotidienne à 09:00 pour CEO : elle avance les objectifs connus, exécute ou délègue du travail borné et rend ses preuves sans attendre une nouvelle instruction. Elle ne lance rien immédiatement, exige que BizOS et le Mac soient actifs à l’échéance et ne contourne ni STOP, ni permissions, ni budgets. Elle n’autorise aucun investissement, dépense, publication, contact externe ou promesse de revenu. Les installations guidées ou historiques ne sont jamais converties automatiquement. Les comptes de cold email, de publicité et de génération d’images ou de vidéos sont les vôtres ; les actions externes ne partent pas automatiquement à l’installation.

## Ce qui est inclus

| Brique | Utilisation |
|---|---|
| Cockpit | Clients, campagnes, tâches, questionnaire d’onboarding et livrables texte |
| 26 skills métier | 21 méthodes adaptées du pack public, plus cinq méthodes originales : offre, relation client, portefeuille, opérations outbound et qualification des réponses |
| Parcours d’agence | De l’offre au reporting client : [guide](docs/AGENCY-PLAYBOOK.md) |
| Second cerveau | Notes et processus personnalisables dans [vault](vault/) |
| Équipe BizOS locale | Agency Director, Acquisition, Onboarding, Strategist, Creative et Account Manager |
| Portabilité | Export/import JSON et dossier client Markdown |
| Sources du runtime | Intégration locale sous [integrations/bizos-local/runtime](integrations/bizos-local/runtime/) |

Les modèles préremplis du cockpit fonctionnent sans IA. En mode autonome, **Rédiger avec mon IA** utilise votre connexion OpenRouter pour produire du texte ; dans BizOS, les agents utilisent le modèle personnel configuré dans l’application. Les skills guident l’assistant et ses outils disponibles. Une image ou une vidéo est livrée lorsque le fichier a réellement été produit par le service choisi.

## Installer les skills dans un autre assistant

Le présent pack Agency fournit 26 skills à l’installation BizOS ; E-commerce en inclut 24. Pour le mode autonome avec votre propre assistant :

```sh
node scripts/install-skills.mjs --target ~/.codex/skills
# Pour le pack E-commerce :
node scripts/install-skills.mjs --pack ecommerce --target ~/.codex/skills
# Ou, pour Claude Code :
node scripts/install-skills.mjs --target ~/.claude/skills
```

L’installateur refuse d’écraser un skill existant. Le [catalogue](docs/SKILLS.md) détaille les entrées, sorties et outils nécessaires.

## Piloter une agence et son portefeuille

Les cinq compléments originaux couvrent l’offre, le suivi client après livraison, la revue du portefeuille, les opérations outbound et la qualification des réponses. Utilisez `agency-portfolio-ops` pour relier clients, campagnes, tâches et prochaines actions ; `outbound-campaign-ops` pour préparer un lot traçable ; `outbound-reply-qualification` pour traiter une réponse et ses relances. Les notes de processus dans le coffre complètent ces skills.

Le cockpit n’est pas un expéditeur cold email ni un CRM de prospects individuels. Les listes et preuves détaillées restent dans le dossier privé du bon client ; l’envoi dépend d’un outil connecté et du mandat de campagne. Une campagne préparée n’est pas une campagne envoyée.

## Clés et connexions

Dans **BizOS SaaS**, les outils autorisés du serveur réalisent les opérations fournisseur ; les clés de plateforme ne doivent jamais être demandées, lues, copiées dans le coffre ou injectées dans les commandes des agents. Les skills sont des méthodes, pas un moyen de contourner cette frontière.

Le **cockpit autonome BYOK** utilise les comptes personnels du propriétaire. Les données et la connexion OpenRouter facultative sont locales et exclues des exports ; un fichier local reste accessible au propriétaire de l’ordinateur. N’y configurez jamais une clé du SaaS BizOS. L’application effective de la frontière SaaS se vérifie dans le backend, pas dans ces instructions Markdown.

## Votre premier client

Suivez [Start Here](docs/START-HERE.md) : renseignez l’agence, créez un client et complétez son onboarding. La soumission prépare une campagne brouillon, une checklist et un brief.

Dans BizOS, demandez par exemple : « Crée le dossier de ce client, prépare son onboarding et enregistre le brief et les prochaines tâches dans le cockpit. » En mode autonome, exportez le dossier Markdown et fournissez-le à votre assistant avec le skill adapté. Relisez les livrables avant leur utilisation commerciale.

## Vérification et contribution

Cockpit autonome :

```sh
npm test
```

Runtime BizOS : commandes dans [docs/BIZOS.md](docs/BIZOS.md). Voir aussi [CONTRIBUTING](CONTRIBUTING.md). Utilisez des fixtures fictives et gardez vos données clients et connexions hors des contributions.

## Exporter les cinq packs natifs

Depuis un checkout de développement avec les dépendances du runtime installées :

```sh
node scripts/export-templates.mjs --output /tmp/bizos-template-export
```

La destination doit être nouvelle. L’export utilise les vrais manifests du runtime et une liste explicite de sources : notes, skills, rôles, licences et cockpits Agency/E-commerce. Il refuse les chemins de secrets, données ou dépendances et les liens symboliques ; il ne copie pas un coffre utilisateur. L’index et les empreintes identifient les fichiers livrés. Le scan de secrets reste un contrôle complémentaire avant tout push.

Les cinq choix de création démarrent avec CEO et des rôles recrutables à la demande. Les anciens espaces E-commerce conservent leur équipe existante. Les fichiers exportés ne lancent pas d’agents et n’accordent aucun droit de fournisseur.

## Licence et origine

Le kit, son cockpit et ses documents originaux sont sous **MIT**. Les 21 skills adaptés viennent de [tarsluna/my-custom-skills](https://github.com/tarsluna/my-custom-skills). Le runtime intégré sous `integrations/bizos-local/runtime/` est sous **AGPL-3.0-only**, avec ses attributions amont conservées. Les détails et textes de licence sont référencés dans [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).

Le logiciel de gestion du kit a été réécrit ; les dossiers clients et l’historique de l’ancien logiciel privé de LeadFactory ne sont pas redistribués.
