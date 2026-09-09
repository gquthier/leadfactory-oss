# Agency et E-commerce dans BizOS local

État au **9 septembre 2026** : parcours vérifié sur **macOS Apple Silicon**, dans une application BizOS empaquetée et un profil de test isolé. Les deux templates sont couverts par les tests du runtime. Le parcours e-commerce empaqueté a aussi été exercé avec Claude : lecture du skill, modification d’un produit, création d’un livrable et personnalisation du dashboard dans la même base. Le parcours client et onboarding Agency possède ses tests métier et une preuve agent de la preview précédente. Cette distribution est une **preview locale**, signée ad hoc et non notarisée.

## Télécharger BizOS ou compiler ses sources

La [release v0.3.0-preview.1](https://github.com/gquthier/leadfactory-oss/releases/tag/v0.3.0-preview.1) fournit :

- `BizOS-Business-Templates-mac-arm64.zip` : application pour Mac Apple Silicon ;
- `BizOS-Business-Templates-desktop-source.tar.gz` : sources correspondantes de l’interface desktop, avec `BUILD-BUSINESS-TEMPLATES.md` ;
- `SHA256SUMS.txt` : sommes de contrôle des deux archives.

Décompressez l’application, placez-la dans le dossier de votre choix puis ouvrez BizOS. Sélectionnez le **mode local** dans les réglages si l’app démarre en mode cloud. macOS peut demander une autorisation manuelle pour cette preview non notarisée. Les binaires Intel, Windows et Linux ne sont pas fournis ni validés dans cette version. Le cockpit autonome reste utilisable avec Node.js.

Pour reconstruire l’application, extrayez l’archive de sources desktop à côté du clone `leadfactory-oss`, puis suivez son `BUILD-BUSINESS-TEMPLATES.md`. Le runtime et les skills proviennent de ce dépôt public ; aucun accès à un dépôt privé n’est nécessaire.

## Choisir son template et son coffre

Les sources actuelles proposent **Agence LeadFactory** et **E-commerce**. Dans **Apps**, choisissez le modèle puis un nouveau coffre ou un dossier déjà partagé. La liaison est enregistrée avant l’installation et reste fixe pour cet espace ; un autre modèle ou coffre est refusé, y compris via l’API. Un coffre déplacé ou indisponible ne provoque pas la création silencieuse d’un espace vide.

L’installation place dans le coffre les notes, les processus, six rôles, leur équipe et les skills : **23 pour Agency**, **24 pour E-commerce**. Les fichiers sont visibles dans **Second cerveau → Dossier**, notamment `Agents/`, `Processes/`, `skills/`, `Clients/` ou `Products/`. Une reprise ajoute les fichiers manquants et conserve les éditions de l’utilisateur.

## Dashboard intégré et agents

Le dashboard de chaque modèle s’affiche directement dans Apps. **Start Here** permet de renseigner son activité et guide les premières connexions. Configurez votre modèle personnel dans les réglages BizOS puis donnez une mission au directeur de l’équipe dans Discussions.

Les formulaires et les outils des agents partagent la même base. Agency dispose des outils `agency_*` pour les clients, campagnes, tâches, livrables et onboarding ; E-commerce dispose de `commerce_*` pour les produits, concurrents, fournisseurs, boutiques, créatives, campagnes, tâches, livrables et relevés. Les agents peuvent aussi adapter la configuration du dashboard : titre, introduction et sections prises en charge. Les checklists et sections métier e-commerce sont configurables ; aucun code arbitraire n’est exécuté depuis ces champs.

Les changements apparaissent sans rechargement manuel. Un formulaire en cours de saisie conserve son brouillon et signale les nouvelles données. Les vues `Clients/<id>/Dossier.md` ou `Products/<id>/Dossier.md` sont générées depuis la base ; ajoutez vos notes humaines à côté, et modifiez les fiches métier dans le dashboard ou via les agents.

Les skills locaux peuvent être adaptés dans `skills/` : les agents lisent cette version du coffre. Les comptes publicitaires, Shopify, email et médias appartiennent à l’utilisateur. L’installation ne les connecte pas automatiquement et n’active aucune routine. Le [guide E-commerce](../ecommerce/README.md) décrit le parcours complet et les dépendances.

Les données embarquées se trouvent sous `<coffre>/Apps/LeadFactory/data` ou `<coffre>/Apps/Ecommerce/data`. Pour sauvegarder, utilisez l’export JSON du dashboard ; pour copier manuellement l’ensemble du coffre, fermez d’abord BizOS et son runtime. Conservez la copie hors des dépôts publics.

## Autonome et embarqué

| | Cockpit autonome | Cockpit embarqué dans BizOS local |
|---|---|---|
| Ouverture | `npm start`, ou dans `ecommerce/` | Dashboard directement dans Apps |
| Données | `data/` du cockpit autonome | `Apps/<modèle>/data` dans le coffre choisi |
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
