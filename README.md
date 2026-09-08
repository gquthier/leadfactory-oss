# LeadFactory Open Agency

Le kit open source pour monter et opérer une agence de génération de leads : **skills, méthodes, second cerveau, rôles d'agents et logiciel de gestion local**.

Cette première version extrait les méthodes réutilisables de LeadFactory. Elle démarre avec vos propres clients, votre offre et vos connexions. Elle ne contient pas les dossiers clients, les résultats historiques ou l'infrastructure privée de l'agence.

## Démarrer

Prérequis : [Node.js 22 ou plus récent](https://nodejs.org/).

[Créer votre copie avec « Use this template »](https://github.com/gquthier/leadfactory-oss/generate), ou cloner directement :

```sh
git clone https://github.com/gquthier/leadfactory-oss.git
cd leadfactory-oss
npm start
```

Ouvrez **http://127.0.0.1:4310**. Aucune dépendance à installer, aucun compte à créer pour le cockpit. Sur macOS, vous pouvez aussi double-cliquer sur `start.command` après avoir installé Node.js.

Le cockpit démarre vide. La démo facultative est entièrement fictive. Les données sont conservées sur votre ordinateur dans `data/`, exclu de Git. Le cockpit est conçu pour un utilisateur local ; ne l'exposez pas comme un SaaS public.

## Ce qui est inclus

| Brique | Utilisation |
|---|---|
| Cockpit | Clients, campagnes, tâches, checklist d'onboarding et livrables texte |
| 23 skills métier | 21 skills adaptés du pack public, plus définition d'offre et relation client après livraison |
| Parcours d'agence | De la définition de l'offre au reporting client : [guide](docs/AGENCY-PLAYBOOK.md) |
| Second cerveau | Dossiers Markdown et rôles génériques dans [vault](vault/) |
| Template BizOS | Données conformes au contrat `CompanyTemplate` observé : [intégration](docs/BIZOS.md) |
| Portabilité | Export/import JSON et dossier client Markdown pour travailler avec un agent |

Les boutons de modèles préremplis fonctionnent sans IA. L'option **Rédiger avec mon IA** utilise votre connexion OpenRouter configurée dans **Start Here** et transmet le contexte du client sélectionné à ce fournisseur. Elle produit du texte. Les skills sont des instructions pour votre assistant : ils ne s'exécutent pas seuls. Pour produire des images, vidéos, recherches en ligne ou campagnes réelles, utilisez les outils et comptes connectés à votre assistant. Les frais éventuels de ces services restent à votre charge.

## Installer les skills

```sh
node scripts/install-skills.mjs --target ~/.codex/skills
# Ou, pour Claude Code :
node scripts/install-skills.mjs --target ~/.claude/skills
```

L'installateur refuse d'écraser un skill existant. Le [catalogue](docs/SKILLS.md) précise les entrées, sorties, dépendances et adaptations. Choisissez le dossier de skills reconnu par votre environnement ; les commandes ci-dessus n'activent aucune connexion ni campagne.

## Votre premier client

1. Ouvrez **Start Here**, renseignez votre agence et configurez vos outils selon vos besoins.
2. Créez un client et complétez son questionnaire d'onboarding. Le brouillon peut être repris avant soumission.
3. La soumission crée sa campagne brouillon, sa checklist et son brief. Préparez ensuite une séquence de cold email ou un autre livrable.
4. Exportez son dossier Markdown et demandez à votre assistant d'appliquer le skill approprié.
5. Vérifiez le livrable, puis réalisez l'action dans votre outil connecté avec l'autorisation et le budget correspondants.

Exemple de demande : « À partir de ce dossier client, utilise `creative-brief` pour préparer trois angles publicitaires. Indique les preuves manquantes et fournis les prompts de génération ; ne présente pas les images comme produites tant qu'elles n'existent pas. »

## État de cette version

Le cockpit, les documents et les skills sont autonomes. La sélection et l'installation de ce template dans l'application BizOS sont **à intégrer** : placer le JSON dans un dossier ne crée pas une équipe exécutable dans BizOS. Le template n'embarque aucun moteur cloud privé.

Il n'y a pas de moteur d'envoi de cold emails, de compte publicitaire connecté, de facturation, de portail client distant ou de génération vidéo intégrée. Le questionnaire d'onboarding se remplit dans le cockpit local, seul ou avec le client. Les processus et skills guident les opérations externes avec les outils de l'utilisateur. « Une agence open source » décrit le kit distribué ; cela ne garantit ni l'acquisition de clients ni une livraison entièrement automatique.

## Vérification et contribution

```sh
npm test
```

Voir [CONTRIBUTING](CONTRIBUTING.md). N'ajoutez jamais vos clients réels, exports, clés API ou fichiers d'environnement à une contribution.

## Licence et origine

MIT pour le code et les documents originaux du kit. Les skills sont adaptés de [tarsluna/my-custom-skills](https://github.com/tarsluna/my-custom-skills), avec leur attribution et licence conservées dans [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md). Le logiciel de gestion a été réécrit pour ce kit : aucun historique du logiciel privé n'est redistribué.
