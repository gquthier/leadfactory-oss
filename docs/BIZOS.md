# Templates d’entreprise dans BizOS local

État au **22 septembre 2026** : le runtime source propose exactement trois choix pour une nouvelle entreprise : **Lead Gen Agency** (`lead-gen-agency`), **Service-based Business** (`service-based-business`) et **Software** (`software`). Les identifiants historiques **Company OS** et **E-commerce** restent reconnus uniquement pour rouvrir sans migration les espaces locaux qui y sont déjà liés.

La release publique v0.3.0-preview.2 décrite ci-dessous est plus ancienne : son application empaquetée expose encore Agency et E-commerce. Elle ne prouve pas le parcours empaqueté des trois choix actuels. Le runtime courant possède ses tests TypeScript ; une validation de l’application empaquetée reste une preuve séparée.

## Télécharger BizOS ou compiler ses sources

La [release v0.3.0-preview.2](https://github.com/gquthier/leadfactory-oss/releases/tag/v0.3.0-preview.2) fournit :

- `BizOS-Business-Templates-mac-arm64.zip` : application pour Mac Apple Silicon ;
- `BizOS-Business-Templates-desktop-source.tar.gz` : sources correspondantes de l’interface desktop, avec `BUILD-BUSINESS-TEMPLATES.md` ;
- `SHA256SUMS.txt` : sommes de contrôle des deux archives.

Décompressez l’application, placez-la dans le dossier de votre choix puis ouvrez BizOS. Sélectionnez le **mode local** dans les réglages si l’app démarre en mode cloud. macOS peut demander une autorisation manuelle pour cette preview non notarisée. Les binaires Intel, Windows et Linux ne sont pas fournis ni validés dans cette version. Le cockpit autonome reste utilisable avec Node.js.

Pour reconstruire l’application, extrayez l’archive de sources desktop à côté du clone `leadfactory-oss`, puis suivez son `BUILD-BUSINESS-TEMPLATES.md`. Le runtime et les skills proviennent de ce dépôt public ; aucun accès à un dépôt privé n’est nécessaire.

## Plusieurs entreprises sur le même Mac

En mode local, le bouton **Entreprises**, juste au-dessus de **Paramètres** dans la sidebar, ouvre la liste des OS regroupés par organisation. L’organisation est un regroupement local pour le même administrateur ; aucun compte cloud n’est nécessaire.

**Créer un nouvel OS** permet de nommer l’entreprise et de choisir une organisation existante ou d’en créer une. BizOS ouvre ensuite cet espace vide ; dans **Apps**, choisissez son template et son coffre. Chaque OS conserve ses propres agents, conversations, données et connexions. Le coffre reste fixe à l’intérieur de cet OS.

Cliquer sur une autre entreprise ferme puis rouvre l’application dans le profil correspondant. Les données restent dans leur OS ; rien n’est déplacé. L’espace local existant est conservé sur place. Si une tâche est encore active, terminez-la ou arrêtez-la avant de changer d’OS.

Pendant une tâche, **Stop remplace le bouton emoji** dans la zone de message. Il annule les tâches actives de cette conversation ; emoji revient quand elles sont terminées ou annulées.

## Choisir son template et son coffre

Pour une nouvelle entreprise, les sources actuelles proposent, dans cet ordre, **Lead Gen Agency**, **Service-based Business** et **Software**. Dans **Apps**, choisissez le modèle puis un nouveau coffre ou un dossier déjà partagé. La liaison est enregistrée avant le premier effet de l’installation et reste fixe pour cet espace ; un autre modèle ou coffre est refusé, y compris via l’API. Après une interruption entre la liaison et le journal d’installation, le redémarrage reprend le même modèle dans le même coffre. Un coffre déplacé, illisible ou remplacé par un lien symbolique ne provoque ni repli vers un autre dossier ni autorisation plus large.

Chaque nouveau clone installe **un seul CEO et son DM**, sans autre agent ni groupe. Lead Gen Agency conserve ses 23 skills, Service-based Business ses processus de qualification à facturation, et Software le second cerveau Ops. Les rôles spécialistes sont conservés sous `Roles/<slug>/role.json` et `system.md` ; `source.md` archive les prompts originaux. Le CEO choisit un rôle quand une mission l’exige. Aucun compte, connecteur ou planning ne devient actif par clonage. Les anciennes installations et les journaux d’installation antérieurs conservent leur équipe complète. Les fichiers sont visibles dans **Second cerveau → Dossier**, notamment `Agents/`, `Processes/`, `Clients/`, `Projects/`, `Deliverables/`, `knowledge/`, `scripts/` ou les dossiers propres au modèle. Une reprise ajoute les fichiers manquants et conserve les éditions de l’utilisateur.

Les anciens espaces liés à Company OS ou E-commerce conservent leur identifiant, leur coffre, leurs agents et leurs données. Ils restent ouvrables mais ne sont ni renommés, ni convertis, ni proposés comme choix de création d’une nouvelle entreprise.

## Dashboard intégré et agents

Le tableau de bord natif local lit un résumé borné de l'espace actuellement
lié via `GET /api/local/dashboard-summary`, derrière le jeton du sidecar.
Les comptes Agence et E-commerce proviennent de leurs fiches locales ; les
résumés Service et Software proviennent des journaux structurés initialisés
dans le coffre. Les agents et routines sont ceux réellement enregistrés.
Les montants E-commerce sont uniquement des relevés saisis à la main, avec
leur devise ; les autres finances et l'email restent indisponibles sans source
locale native. Une source absente ou invalide ne devient jamais un faux zéro.
La section `attention` expose ce que les agents attendent (question, autorisation,
décision Ops, échec des dernières 24 h) avec le fil public où répondre ; la
réponse passe par les routes de conversation existantes.
Il expose aussi l'activité (jetons du jour et du mois d'après les exécutions
enregistrées, exécutions du jour, en cours et en file, dernier échec), le plan
ou fournisseur actif et son usage, le mode de permissions et les étapes de mise
en route.

Lead Gen Agency conserve son cockpit métier intégré ; les anciens espaces E-commerce conservent le leur. Service-based Business et Software fonctionnent avec CEO, les spécialistes recrutés au besoin et **Second cerveau → Dossier** ; ce lot ne leur invente pas de CRM ou de dashboard métier. Leur note **Start here** recueille les faits de l’activité. Configurez votre modèle personnel dans les réglages BizOS puis donnez une mission à CEO dans Discussions.

Dans un coffre lié, chaque agent démarre dans `Agents/<Nom>` et reçoit le chemin vérifié du coffre commun comme racine de travail partagée. Un agent recruté rejoint ce même coffre même si un ancien dossier de travail global est configuré. Cette autorisation concerne uniquement le coffre explicitement lié à cet OS local ; aucun autre coffre historique ni la racine d’état du runtime n’est ajouté.

Les outils `recruit_agent` et `manage_agent` sont réellement disponibles aux runs Codex et Claude lorsque leur transport local est monté. Cursor ne reçoit pas ces outils injectés. Depuis son DM, CEO peut appeler `recruit_agent` avec `role_slug`, une description, du contexte et une vraie `initial_task`. Le runtime crée ou réutilise l’agent persistant, son DM et une équipe, puis renvoie le statut réel et les identifiants de la mission. Une photo PNG/JPEG/WebP peut être fournie par `avatar_data_url` (32 768 caractères maximum) ; les données de l’image sont projetées dans le bootstrap du desktop, pas dans la réponse MCP compacte. Une demande répétée conserve l’identité du rôle et ne réactive pas un agent suspendu ou supprimé. `manage_agent` ajuste le profil ou la mission sans supprimer le rôle de base. Un transfert `@Nom` reste limité à un groupe existant contenant les participants. Une chaîne est bornée à quatre sauts et douze tours sans revisiter un agent. Les checkpoints peuvent ajouter au plus trois continuations ; un run interrompu n’est pas repris automatiquement après redémarrage.

Les formulaires et les outils des agents partagent la même base. Agency dispose des outils `agency_*` pour les clients, campagnes, tâches, livrables et onboarding ; E-commerce dispose de `commerce_*` pour les produits, concurrents, fournisseurs, boutiques, créatives, campagnes, tâches, livrables et relevés. Les agents peuvent aussi adapter la configuration du dashboard : titre, introduction et sections prises en charge. Les checklists et sections métier e-commerce sont configurables ; aucun code arbitraire n’est exécuté depuis ces champs.

Les changements apparaissent sans rechargement manuel. Un formulaire en cours de saisie conserve son brouillon et signale les nouvelles données. Les vues `Clients/<id>/Dossier.md` ou `Products/<id>/Dossier.md` sont générées depuis la base ; ajoutez vos notes humaines à côté, et modifiez les fiches métier dans le dashboard ou via les agents.

Les skills locaux peuvent être adaptés dans `skills/` : les agents lisent cette version du coffre. Les comptes CRM, paiement, publicité, Shopify, email et médias appartiennent à l’utilisateur. L’installation ne les connecte pas automatiquement et n’active aucune routine. Une routine créée explicitement avec le mécanisme natif exige que le runtime fonctionne et que le Mac soit réveillé à l’heure prévue. Le [guide E-commerce](../ecommerce/README.md) reste la documentation des anciens espaces E-commerce.

Les données embarquées se trouvent sous `<coffre>/Apps/LeadFactory/data` ou `<coffre>/Apps/Ecommerce/data`. Pour sauvegarder, utilisez l’export JSON du dashboard ; pour copier manuellement l’ensemble du coffre, fermez d’abord BizOS et son runtime. Conservez la copie hors des dépôts publics.

## Ollama dans BizOS local

Dans **Paramètres → Plans et utilisation**, ajoutez un connecteur Ollama pointant vers
le serveur déjà lancé sur cette machine (`http://127.0.0.1:11434` par défaut),
puis lancez le contrôle des modèles. BizOS lit les modèles installés via
`/api/tags` et leurs capacités via `/api/show`. Choisissez explicitement un
modèle local compatible chat pour les discussions rapides, ou un modèle qui
annonce aussi la capacité `tools` pour les agents. Aucun modèle n’est choisi ou
téléchargé automatiquement ; une sélection supprimée ou devenue distante
échoue avec une erreur visible.

Les tours Ollama appellent directement `/api/chat` sur l’adresse loopback.
Ils n’ont besoin ni de CLI Codex/Claude/Cursor, ni de compte, ni de clé API.
Les agents peuvent utiliser les outils métier et d’équipe que ce runtime leur
monte réellement, avec les autorisations et STOP existants. Les discussions
rapides restent textuelles ; Ollama ne reçoit pas de shell, navigateur,
lecteur de fichiers, applications MCP ou pièces jointes dans ce lot. Les
routines et les agents recrutés gardent la sélection explicite du modèle.
Chaque run expose le connecteur et le modèle utilisés, ainsi que les compteurs
de tokens réellement fournis par Ollama, sans estimation de coût.

## Tâches vocales locales

La preview vocale délègue chaque demande finalisée à un agent local réel. Le
sidecar résout lui-même la conversation directe et lie la tâche au compte
personnel Codex ou Claude choisi pour cet agent, ou au plan actif si l’agent
n’a pas de surcharge. Un changement de compte pendant l’appel est détecté et
refusé ; une erreur de quota ne bascule pas vers un autre compte ou fournisseur.

Chaque demande et sa réponse restent dans l’historique normal de l’agent. STOP
vise uniquement les exécutions appartenant à l’appel et l’état reste actif tant
que l’annulation n’a pas été confirmée. Dans cette première tranche, les outils
de recrutement et la délégation à un autre agent sont retirés des tâches
vocales afin qu’aucune exécution enfant n’échappe à STOP. Les discussions texte
conservent leur fonctionnement habituel. La clé du service vocal reste dans le
processus principal de l’application et n’est jamais proposée comme fournisseur
de tâches au runtime.

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
