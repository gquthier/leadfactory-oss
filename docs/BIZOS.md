# LeadFactory dans BizOS local

État au **9 septembre 2026** : parcours vérifié sur **macOS Apple Silicon**, dans une application BizOS empaquetée et un profil de test isolé. Installation des six agents, ouverture du cockpit authentifié, lecture d’un skill par Claude, création d’un client fictif et enregistrement de son brief ont été observés. Cette distribution est une **preview locale**, signée ad hoc et non notarisée.

## Télécharger BizOS ou compiler ses sources

La [release v0.2.0-preview.1](https://github.com/gquthier/leadfactory-oss/releases/tag/v0.2.0-preview.1) fournit :

- `BizOS-LeadFactory-mac-arm64.zip` : application pour Mac Apple Silicon ;
- `BizOS-LeadFactory-desktop-source.tar.gz` : sources correspondantes de l’interface desktop, avec `BUILD-LEADFACTORY.md` ;
- `SHA256SUMS.txt` : sommes de contrôle des deux archives.

Décompressez l’application, placez-la dans le dossier de votre choix puis ouvrez BizOS. Sélectionnez le **mode local** dans les réglages si l’app démarre en mode cloud. macOS peut demander une autorisation manuelle pour cette preview non notarisée. Les binaires Intel, Windows et Linux ne sont pas fournis ni validés dans cette version. Le cockpit autonome reste utilisable avec Node.js.

Pour reconstruire l’application, extrayez l’archive de sources desktop à côté du clone `leadfactory-oss`, puis suivez son `BUILD-LEADFACTORY.md`. Le runtime et les skills proviennent de ce dépôt public ; aucun accès à un dépôt privé n’est nécessaire.

## Installer l’agence

Dans une version BizOS locale qui inclut cette intégration, ouvrez **Apps → Agence LeadFactory → Installer**.

L’installation crée :

- six agents : **Agency Director**, **Acquisition**, **Onboarding**, **Strategist**, **Creative**, **Account Manager** ;
- leur équipe et les **23 skills** fournis par ce dépôt ;
- un vault dédié avec les notes, rôles et processus de l’agence.

Votre second cerveau existant est conservé. Le fichier [CompanyTemplate](../templates/lead-gen-agency.company-template.json) fournit la matière du template ; le runtime local réalise l’installation. Aucune routine n’est créée par défaut.

Configurez votre modèle dans les **réglages BizOS**, avec votre propre connexion Codex, Claude ou Cursor parmi les options disponibles. Dans **Discussions**, demandez à Agency Director de préparer un premier client et son onboarding. Les autres agents interviennent selon la mission confiée et les outils configurés.

## Ouvrir et utiliser le cockpit partagé

Depuis la fiche **Agence LeadFactory**, ouvrez le dashboard. BizOS démarre le cockpit local et fournit une session authentifiée. Si le lien d’ouverture expire, rouvrez-le depuis la fiche de l’app.

Les agents disposent des outils `agency_*` pour gérer les clients, campagnes, tâches, livrables et l’onboarding. Ces outils et le dashboard utilisent **les mêmes données de l’espace BizOS local**. Un brief enregistré par un agent apparaît donc dans les livrables du client, sans export/import intermédiaire.

Le cockpit vérifie les changements toutes les **trois secondes**. Pendant une saisie ou lorsqu’un brouillon n’est pas enregistré, il préserve votre travail et affiche un avis de mise à jour. Les notes du vault complètent le dossier client ; elles ne remplacent pas l’enregistrement des livrables dans le cockpit.

Ouvrez **Start Here** pour renseigner votre agence. Le modèle des agents se configure dans BizOS. Pour la prospection, la publicité et les médias, branchez vos propres comptes et outils ; installation et onboarding ne déclenchent aucun envoi, publication ou dépense externe.

## Autonome et embarqué

| | Cockpit autonome | Cockpit embarqué dans BizOS local |
|---|---|---|
| Ouverture | `npm start` à la racine du kit | Fiche Agence LeadFactory dans Apps |
| Données | `data/` du clone | Espace local de l’agence géré par BizOS |
| Agents | Assistant externe choisi par l’utilisateur | Équipe installée dans BizOS, outils `agency_*` |
| Rédaction IA | OpenRouter facultatif dans Start Here | Modèle personnel des agents, configuré dans BizOS |
| Contexte | Export Markdown à fournir à l’assistant | Clients et livrables partagés avec le cockpit |
| Accès au dashboard | Adresse locale sur l’ordinateur | Session locale authentifiée ouverte par BizOS |

Lancer `npm start` à la racine ne rattache pas automatiquement ce cockpit autonome à votre espace BizOS. Utilisez l’export/import pour déplacer volontairement vos données entre espaces.

## Compiler le runtime depuis le clone

Prérequis : **Node.js 22 ou plus récent**, npm et le clone complet du dépôt. Depuis sa racine :

```sh
cd integrations/bizos-local/runtime
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run build
npm test
```

`npm ci` installe les dépendances verrouillées. La variable évite le téléchargement du binaire Electron, utilisé ici pour les types. Le build synchronise le cockpit, les skills et les notes depuis le kit, compile le runtime puis copie les ressources nécessaires. `npm test` lance les tests ciblés de l’agence, du kit embarqué et de leur intégration au sidecar.

Ce dossier contient le runtime local, pas à lui seul l’interface desktop de discussion. `npm start` dans ce dossier démarre le sidecar compilé ; ce n’est pas le lancement du cockpit autonome ni celui d’une application desktop complète. Les sources de l’interface et leur guide de compilation sont joints à la release indiquée plus haut.

## Périmètre et licences

Cette intégration cible **BizOS local OSS**. Elle n’importe ni moteur privé cloud, ni identité, ni conversations ou connexions d’une entreprise cloud. L’usage d’un modèle distant personnel reste une connexion au fournisseur choisi.

Le runtime sous `integrations/bizos-local/runtime/` est **AGPL-3.0-only** ; ses notices amont sont conservées avec les sources. Le kit d’agence reste **MIT**. Voir [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) et [le README du runtime](../integrations/bizos-local/runtime/README.md).
