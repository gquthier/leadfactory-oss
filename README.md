<div align="center">

<img src="https://img.shields.io/badge/MARKETING-AGENCY-6E56CF?style=flat-square&labelColor=6E56CF&color=1A1A1A" alt="MARKETING · AGENCY">

# LeadFactory Open Agency

### Tout le système d’une agence de génération de leads. À reprendre et à faire vôtre.

Le logiciel, les skills, le contexte, les processus et les agents.<br>De l’acquisition au dernier livrable, les briques pour construire<br>votre agence avec vos outils, vos comptes et votre façon de travailler.

<br>

<a href="https://bizos.cc">
<img src="https://img.shields.io/badge/BizOS-build%20autonomous%20companies-0A0A0A?style=for-the-badge&labelColor=0A0A0A" alt="BizOS — build autonomous companies">
</a>

<br><br>

<a href="https://x.com/gauthierthiry"><img src="https://img.shields.io/badge/@gauthierthiry-0A0A0A?style=flat-square&logo=x&logoColor=white" alt="X"></a> <a href="https://youtube.com/@gquthier"><img src="https://img.shields.io/badge/@gquthier-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube"></a>

<br>

<sub>Agence complète · logiciel & espaces clients · 39 skills · 12 modules vidéo optionnels · 8 rôles IA · contexte & processus · onboarding · SQL · Codex & Claude Code · vos propres comptes</sub>

</div>

---

**La promesse : open sourcer LeadFactory, toute l’agence.** Ce dépôt réunit le système réutilisable de l’agence : comment elle s’organise, comment elle trouve des clients, comment elle accueille un nouveau dossier, comment ses agents travaillent et comment elle produit et livre les campagnes. Le logiciel est inclus, avec les skills, les prompts, le contexte et les processus.

**[Start Here](full-app/docs/START-HERE.md) · [Contexte](vault/Company.md) · [Skills](docs/SKILLS.md) · [Agents](agents/README.md) · [Logiciel](full-app/README.md) · [Connexions](full-app/docs/START-HERE.md#5-connecter-slack)**

**Préversion privée — 2 octobre 2026.** Le dépôt reste privé pendant la préparation. L’ouverture à tous est l’objectif ; la [licence du logiciel interne](full-app/NOTICE.md) reste à confirmer avant publication. Les composants déjà sous licence ouverte conservent leurs droits. Aucun compte, fichier client ou résultat commercial de l’agence d’origine n’est destiné à être fourni. [Statut et périmètres](docs/DISTRIBUTION.md).

## Tout ce que vous récupérez

| Brique | Contenu | Ouvrir |
|---|---|---|
| **Contexte de l’agence** | Entreprise, mission, règles, autonomie, décisions et carte des connaissances à personnaliser | [Contexte](vault/Company.md) · [Démarrage](<vault/Start here.md>) |
| **Processus métier** | Acquisition, onboarding, delivery, propositions, retours client et revue de portefeuille | [Playbook](docs/AGENCY-PLAYBOOK.md) · [Processus](vault/Processes/) |
| **Agents** | Huit rôles, prompts système complets, compétences et passations | [Équipe IA](agents/README.md) |
| **Skills** | 39 skills : offre, recherche, vente, cold email, ads, copy, création et opérations | [Catalogue](docs/SKILLS.md) |
| **Studio créatif** | Montage, UGC, film produit, motion Meta et 12 modules vidéo optionnels | [Studio](docs/CREATIVE-STUDIO.md) |
| **Logiciel** | Dashboard agence, équipe, clients, campagnes, CRM, finances et ressources | [Application complète](full-app/README.md) |
| **Onboarding & espaces clients** | Formulaire, brief, préparation de proposition et interfaces client | [Start Here](full-app/docs/START-HERE.md) · [Accès clients](full-app/CONFIDENTIALITY.md) |
| **Données & connexions** | Schéma SQL vide de 50 tables, CLI personnel et guides Slack, Meta, voix et email | [SQL](full-app/database/README.md) · [Connexions](full-app/docs/START-HERE.md) |

Les fichiers métier sont des bases réutilisables à adapter à votre agence. Ils ne contiennent pas la clientèle, les identités vocales, les tokens ou les comptes publicitaires de l’agence d’origine. Les outils externes et les comptes sont les vôtres.

## Démarrer votre agence

Clonez le pack complet : vous récupérez le contexte, les processus, les agents, les skills et le logiciel. Prérequis pour lancer le dashboard : **Node.js 22+** et un accès au dépôt privé pendant la préparation.

```sh
git clone --branch preview/leadfactory-open-agency-20261002 https://github.com/gquthier/leadfactory-oss.git
cd leadfactory-oss

# Puis, pour ouvrir le logiciel de gestion :
cd full-app
npm ci
npm run dev
```

Commencez aussi par le [contexte de l’agence](vault/Company.md), sa [mission](vault/Mission.md) et ses [règles](vault/Rules.md) : adaptez ces fichiers à votre offre et à vos responsabilités.

Pour le dashboard, ouvrez **http://127.0.0.1:14320/admin/start-here**. Le logiciel démarre localement, sans clé API ni base distante. Suivez ensuite le **[Start Here complet](full-app/docs/START-HERE.md)** pour configurer votre agence et votre IA.

Dans **IA personnelle**, choisissez **Codex CLI** ou **Claude Code CLI**, déjà connecté sur votre machine, puis **Vérifier et connecter mon IA**. OpenRouter est également proposé. Les missions utilisent votre compte et son fournisseur ; elles ne sont pas exécutées hors ligne.

## Le logiciel inclus dans l’agence

| Espace | Ce que le code contient | Guide |
|---|---|---|
| Pilotage | Dashboard, clients, campagnes, tâches, résultats et finances | [Logiciel complet](full-app/README.md) |
| Équipe | Recrutement, gestion de l’équipe et rôles IA | [Huit agents](agents/README.md) |
| Onboarding | Formulaire neuf étapes, dossier, brief et préparation de campagne | [Parcours de démarrage](full-app/docs/START-HERE.md) |
| Espace client | Aperçu, campagnes, CRM, leads, tâches, formations et paramètres | [Comptes et accès](full-app/CONFIDENTIALITY.md) |
| Delivery | Propositions, ressources, créatives, retours et suivi | [Playbook agence](docs/AGENCY-PLAYBOOK.md) |
| Création | Statiques, montage, film produit, UGC et motion Meta 9:16 | [Studio créatif](docs/CREATIVE-STUDIO.md) |
| Données | Persistance JSON locale et schéma SQL vide de 50 tables | [Guide SQL](full-app/database/README.md) |

Le dashboard client est inclus. En mode local, les espaces sont des aperçus administratifs ; les comptes clients authentifiés demandent la configuration Auth et une recette. Certains adaptateurs externes restent à connecter.

## Du brief à la proposition

1. **Créez un client fictif** et complétez son onboarding dans le logiciel.
2. **Rassemblez ses sources** : offre, site, charte, objectifs et contraintes autorisés.
3. **Connectez votre IA** et activez explicitement l’automatisation si vous la souhaitez.
4. **Quatre rôles préparent le travail** : Onboarding → Créatif stratégiste → Media Buyer → Communication client. Le serveur et la machine doivent rester ouverts.
5. **Relisez la proposition enregistrée** : angles, livrables, hypothèses, budget proposé et prochaine action. La diffusion publicitaire et l’envoi client sont des étapes distinctes.

Le logiciel complet propose son formulaire neuf étapes. Le [cockpit léger et son portail individuel](docs/DEMO-ONBOARDING.md) constituent un autre parcours, avec un formulaire cinq étapes et une base séparée. Le portail du cockpit n’authentifie pas les clients du logiciel complet.

## Votre équipe de huit agents

Chaque rôle possède un prompt système, ses skills, un périmètre et des critères de livraison. La présence des fichiers ne lance aucun agent permanent.

| Rôle | Responsabilité | Prompt |
|---|---|---|
| CEO | Offre, priorités, capacité et qualité | [Ouvrir](agents/prompts/ceo.system.md) |
| Acquisition | Positionnement, vente et acquisition de clients pour l’agence | [Ouvrir](agents/prompts/acquisition.system.md) |
| Onboarding | Inputs, accès, brief et passation | [Ouvrir](agents/prompts/onboarding.system.md) |
| Delivery | Production, délais, recette et retouches | [Ouvrir](agents/prompts/delivery.system.md) |
| Media Buyer | Tracking, structure de campagne et optimisation | [Ouvrir](agents/prompts/media-buyer.system.md) |
| Cold Email | Recherche, séquences, délivrabilité et réponses | [Ouvrir](agents/prompts/cold-email.system.md) |
| Créatif stratégiste | Concepts, copy, statiques, vidéos et motion design | [Ouvrir](agents/prompts/creative-strategist.system.md) |
| Communication client | Propositions claires, messages et suivi client | [Ouvrir](agents/prompts/client-communication.system.md) |

[Mode d’emploi des agents](agents/README.md) · [39 skills et 12 modules optionnels](docs/SKILLS.md) · [Inventaire et niveau de vérification](docs/SKILL-AUDIT.md).

## Vos connexions, expliquées

| Connexion | Ce qui est fourni | Mise en place |
|---|---|---|
| Codex / Claude Code | Adaptateur pour utiliser le CLI personnel connecté | [IA personnelle](docs/PERSONAL-CLI.md) |
| Slack | Saisie du token et test d’identité ; notifications à intégrer | [App, scopes et token](full-app/docs/START-HERE.md#5-connecter-slack) |
| Meta | Adaptateurs OAuth, actifs, statistiques et leads ; recette du compte nécessaire | [Marketing API et permissions](full-app/docs/START-HERE.md#6-connecter-meta-pour-les-campagnes) |
| ElevenLabs | Configuration personnelle et helper voix pour le workflow motion | [Voix et créatives](full-app/docs/START-HERE.md#7-voix-et-créatives-motion-design) |
| Supabase | SQL vide, chemins Auth et configuration distante explicite | [Schéma et accès](full-app/database/README.md) |
| Email / CRM | Sources des adaptateurs et configuration par fournisseur | [Email et sources](full-app/docs/START-HERE.md#8-email-crm-et-sources-complémentaires) |

Les tests de compte dans Start Here vérifient un accès en lecture. Ils ne raccordent pas automatiquement tous les anciens adaptateurs et ne valident pas les permissions métier. [Catalogue technique des intégrations](full-app/docs/integration-catalog.json).

Pour les **ads motion Meta**, partez de la marque et du site, préparez script/storyboard, produisez la voix ElevenLabs, puis animez et vérifiez le format vertical. [Workflow et helper](skills/agency-meta-motion-ad/SKILL.md). Le formulaire ne lance pas automatiquement un rendu vidéo.

## Le pack de l’agence et l’intégration BizOS

**Ce dépôt rassemble toute la partie réutilisable de LeadFactory** : le contexte, les méthodes, les prompts, les skills et le logiciel. Le logiciel est l’un des composants du pack. Les fichiers de contexte sont volontairement vierges de données clients réelles et prêts à personnaliser.

L’[intégration BizOS](templates/README.md) est une manière facultative d’utiliser ce contenu : elle fournit les manifests pour charger les rôles, skills et notes dans un environnement compatible. Elle possède son coffre et son cockpit ; elle ne synchronise pas automatiquement la base du logiciel complet. Sa disponibilité dans la version actuelle de BizOS reste à vérifier.

Un **template GitHub** est simplement une fonction de copie de dépôt. Cela ne définit ni le contenu ni la licence du projet. L’objectif ici est bien d’ouvrir le système de l’agence, pas de livrer seulement un template pour BizOS. [Statut et explication](docs/DISTRIBUTION.md).

<details>
<summary>Autres outils du dépôt : cockpit léger, E-commerce et installation des skills</summary>

Le cockpit léger autonome démarre avec `npm start` à la racine sur **http://127.0.0.1:4310**. `npm run demo` ajoute son portail individuel. Il a sa propre base et ne nécessite aucune dépendance Node à installer. [Start Here du cockpit](docs/START-HERE.md) · [Démo](docs/DEMO-ONBOARDING.md).

Le template [E-commerce](ecommerce/README.md) possède également son propre cockpit. Le [catalogue privé](https://github.com/gquthier/bizos-templates) réunit les différents packs métier.

Pour installer les skills dans un projet personnel :

```sh
node scripts/install-skills.mjs --target ./my-agency/.claude/skills
node scripts/install-skills.mjs --pack creative --target ./my-agency/.claude/skills
```

Utilisez `.codex/skills` pour un projet Codex. L’installation refuse d’écraser un skill existant. Le moteur de rendu et les fournisseurs média se configurent séparément.

</details>

## Lire, vérifier et contribuer

- **Installation et connexions :** [Start Here](full-app/docs/START-HERE.md), [variables vierges](full-app/env.example), [SQL](full-app/database/schema.sql).
- **Usage :** [logiciel](full-app/README.md), [agents](agents/README.md), [playbook](docs/AGENCY-PLAYBOOK.md), [studio créatif](docs/CREATIVE-STUDIO.md).
- **Périmètre vérifié :** [confidentialité et accès clients](full-app/CONFIDENTIALITY.md), [validation](full-app/VALIDATION.md), [contribution](CONTRIBUTING.md).
- **Contexte et processus :** [agence](vault/Company.md), [mission](vault/Mission.md), [équipe](vault/Team.md), [carte des connaissances](<vault/Knowledge map.md>), [présentation complète](OPEN-AGENCY.md).

Les données métier et tokens ajoutés localement restent exclus de Git. Le mode local est un atelier administratif sur votre machine ; le passage à un portail Internet demande une recette Auth, droits, RLS et isolation clients. Aucune base de l’agence d’origine n’est fournie ou connectée.

Dans `full-app/` : `npm run typecheck`, `npm test`, `npm run build`. À la racine : `npm test`. Les connexions fournisseur ne sont pas certifiées par ces seuls tests.

## Licences et ouverture future

**Kit : MIT · runtime intégré : AGPL-3.0-only · modules HyperFrames : Apache-2.0**, avec leurs attributions et licences de polices. Voir [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).

**Logiciel interne `full-app/` : droits et licence à confirmer avant publication**, selon sa [notice](full-app/NOTICE.md). Le statut « template » sur GitHub ne modifie aucune licence. La branche de présentation est distribuée depuis les fichiers contrôlés, sans reprendre l’ancien historique du chantier. Le dépôt reste privé.

---

<div align="center">

### Building something that runs itself?

**[bizos.cc](https://bizos.cc)** — build autonomous companies.

<a href="https://x.com/gauthierthiry"><img src="https://img.shields.io/badge/@gauthierthiry-0A0A0A?style=flat-square&logo=x&logoColor=white" alt="X"></a> <a href="https://youtube.com/@gquthier"><img src="https://img.shields.io/badge/@gquthier-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube"></a>

<br><br>

<sub>Built by <a href="https://x.com/gauthierthiry">Gauthier Thiry</a></sub>

</div>
