# Start Here — LeadFactory, l’agence complète

Lecture et documentation : **1er octobre 2026**. Statut : **starter privé, local et déconnecté par défaut**. Source du logiciel : `gquthier/leadfactory-app`, révision `e909784b7a28982825b3a1b4d7ee0ff8b27e9bf1`. Le dashboard, l’équipe, les clients, l’onboarding, le CRM, les campagnes, les résultats, les finances, les ressources, les formations et les outils créatifs proviennent de cette application interne. Les données et connexions de l’agence d’origine ne font pas partie du starter.

Le pack parent apporte les [huit agents](../../agents/README.md), leurs [prompts](../../agents/prompts/), leurs [skills](../../skills/), le [workflow d’onboarding](../../docs/DEMO-ONBOARDING.md) et la [connexion CLI personnelle](../../docs/PERSONAL-CLI.md). Le catalogue [integration-catalog.json](integration-catalog.json) décrit les connexions possibles ; `not_configured` signifie qu’aucune connexion n’est présumée active. Un fichier de configuration ou un bouton présent ne prouve pas qu’un fournisseur a été testé.

## 1. Ouvrir le logiciel sans connecter de données

Le logiciel utilise Next.js **15.5.27**. Installer Node.js 22 ou plus récent, puis depuis la racine du pack :

```sh
cd full-app
npm ci
npm run dev
```

Ouvrir **http://127.0.0.1:14320/admin/start-here**. Le serveur écoute uniquement sur `127.0.0.1:14320`. Ne pas exposer ce mode derrière un tunnel ou proxy public. Le mode initial ne se connecte pas à une base distante, même si le terminal possède déjà des variables Supabase. Conserver les modes `local`, `LEADFACTORY_CONNECT_DATABASE=0` et `LEADFACTORY_ENABLE_EXTERNAL=0` du fichier [env.example](../env.example), ou laisser l’environnement non configuré. Le fichier `.local-data/db.json` démarre vide, hormis un administrateur fictif. Créer ses propres exemples pour la démonstration. Aucune donnée métier d’origine n’est incluse. Cette identité locale sert à parcourir les écrans et aperçus client ; elle ne remplace pas une authentification de production.

Parcours conseillé : Start Here → Dashboard → Équipe → Clients → Onboarding → Campagnes → CRM → Résultats → Ressources. Construire une offre, recruter les rôles utiles, compléter un brief fictif, préparer une proposition et examiner son contenu. Les boutons de synchronisation, génération payante, email et publication nécessitent une activation distincte.

## 2. Organiser son agence et ses agents

Le [roster](../../agents/roster.json) est la référence des rôles et des skills. Commencer par le CEO puis mobiliser les spécialistes selon la mission. Un agent reçoit un périmètre de client, les sources utiles et un livrable attendu. Une connexion fournisseur ne lui donne pas automatiquement accès à tous les clients.

| Agent | Sources autorisées à lui fournir | Skills principaux | Livrable et passage de relais |
| --- | --- | --- | --- |
| CEO | Offre, capacité de l’équipe, pipeline, coûts et résultats agrégés | `agency-portfolio-ops`, `agency-offer-design`, `agency-offer-lab`, `agency-client-success` | Priorités, responsabilité, capacité et arbitrages vers les spécialistes |
| Acquisition | Offre, recherches sourcées, prospects qualifiés, comptes rendus commerciaux autorisés | `agency-offer-lab`, `agency-one-to-many-sales`, `agency-prospect-research`, `cold-call-expert` | Opportunité qualifiée et engagement confirmé vers Onboarding |
| Onboarding | Questionnaire, site public, fichiers de marque, périmètre vendu et statut des accès | `client-onboarding-flow`, `sales-call-analyzer`, `agency-offer-design` | Brief, informations manquantes et périmètre d’accès vers Delivery |
| Delivery | Brief validé, planning, versions de livrables, retours et accords du client | `agency-client-success`, `agency-portfolio-ops`, `client-onboarding-flow`, `campaign-proposal` | Livraison, contrôle qualité, prochaine action et suivi client |
| Media Buyer | Compte publicitaire choisi, budgets confirmés, événements, statistiques et créatives validées | `agency-media-buying`, `meta-campaign-launcher`, `rework-campaign`, `campaign-proposal` | Proposition de structure puis préparation de campagne ; publication séparément autorisée |
| Cold Email | ICP, contacts autorisés, sources, exclusions, domaine d’envoi et réponses reçues | `agency-prospect-research`, `agency-email-deliverability`, `outbound-sequence-writer`, `outbound-campaign-ops`, `outbound-reply-qualification` | Liste qualifiée, séquence en brouillon et suivi ; envoi séparément autorisé |
| Creative Strategist | Site, charte, fichiers autorisés, preuves, brief et observations créatives | `creative-brief`, `agency-brand-direction`, `agency-creative-testing`, `agency-meta-motion-ad` | Angles, storyboard, créatives et hypothèses de test vers Media Buyer |
| Communication client | Proposition préparée, livrables validés, questions et décisions confirmées | `campaign-proposal`, `agency-client-success`, `sales-follow-up-sequence` | Proposition claire, message à relire et suivi des validations |

Les prompts complets sont dans `agents/prompts/<rôle>.system.md`, à la racine du pack. Les 39 skills d’agence et les 12 skills HyperFrames facultatifs ont des périmètres différents : leur présence ne signifie pas que chaque API nécessaire est connectée. Les méthodes commerciales du pack sont des adaptations documentées, pas la promesse de revenus d’un auteur tiers.

## 3. IA personnelle : Claude Code ou Codex

Utiliser le CLI installé et connecté sur **la même machine et le même compte système que ce serveur**. Vérifier `codex --version` ou `claude --version`. Si nécessaire, lancer personnellement `codex login` ou `claude auth login`. Voir [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) et [Claude Code Quickstart](https://code.claude.com/docs/en/quickstart).

1. Dans **Start Here → IA personnelle**, choisir Codex CLI ou Claude Code CLI. Codex est le choix initial de l’interface. Le modèle facultatif vide conserve le choix par défaut du CLI.
2. Cliquer **Vérifier et connecter mon IA**. Le logiciel complet appelle directement l’adaptateur CLI du pack parent ; il n’est plus nécessaire de lancer un second cockpit. Cette vérification n’est pas une génération et ne prouve pas le quota du compte.
3. Dans **Agents**, recruter un rôle, choisir un client, joindre les sources autorisées et préciser le livrable. Les prompts et skills sont chargés depuis le pack parent : ne pas déplacer `full-app` seul.
4. Pour l’enchaînement après formulaire, cocher explicitement **Démarrer les quatre rôles de rédaction à chaque onboarding terminé**, puis enregistrer la connexion. Le formulaire complet `/onboarding` déclenche alors Onboarding → Creative Strategist → Media Buyer → Communication client. Sans cette option ou sans fournisseur, l’onboarding reste une opération locale.
5. Suivre les exécutions dans **Agents**, utiliser l’arrêt si nécessaire et relire la proposition produite dans la campagne. Quatre exécutions maximum par onboarding ; aucune publication publicitaire ni communication client automatique. Le serveur et la machine doivent rester ouverts.

Les missions reçoivent le contexte du client choisi, les sources sélectionnées et les résultats des rôles précédents. Une URL de source sert de référence ; le moteur de rédaction ne parcourt pas automatiquement le site. Ajouter les extraits, preuves et fichiers utiles. Le résultat doit distinguer faits, hypothèses et informations manquantes. Le statut de relecture ne signifie pas qu’une campagne est active. Le [guide de l’adaptateur CLI](../../docs/PERSONAL-CLI.md) documente ses limites d’exécution ; les écrans du logiciel complet sont décrits ici.

Pour OpenRouter, enregistrer d’abord son token dans **Mes connexions personnelles**, choisir OpenRouter dans **IA personnelle**, renseigner un modèle accessible et connecter. Voir [authentification OpenRouter](https://openrouter.ai/docs/api_reference/authentication). Les anciennes routes Gemini/OpenRouter restent distinctes : elles ne sont pas toutes remplacées par le CLI.

Le modèle réellement retourné doit être conservé lorsqu’il est communiqué ; ne pas transformer un modèle demandé en preuve du modèle utilisé. Pour le workflow motion design, la préférence de conception conservée est **Opus 5.5**, à choisir seulement si votre accès le propose. Aucune substitution silencieuse après quota épuisé.

Les identifiants du CLI restent gérés par lui, sans copie dans le projet ni dans une archive. Les textes sont traités par son fournisseur : local ne signifie pas modèle hors ligne. Les tokens saisis dans Start Here sont stockés côté serveur dans `.local-data/integrations.json`, **0600**, exclus de Git et jamais renvoyés dans l’état de connexion affiché. Ce fichier n’est pas chiffré au repos. Retirer un token dans l’interface supprime la configuration de ce service ; protéger aussi le compte système et le disque.

## 4. Préparer sa propre base SQL, plus tard

Le fichier [database/schema.sql](../database/schema.sql) contient le schéma complet de **50 tables**, sans compte ni donnée métier. Le bouton **Télécharger le schéma SQL** appelle `/api/starter/schema`. Lire le [guide SQL](../database/README.md) avant import : ce fichier regroupe les quatre étapes SQL, dont les agents, dans une transaction. **Aucune importation ni connexion n’a été exécutée pour vous.**

1. Créer un projet Supabase vide qui vous appartient. Vérifier son nom avant toute opération.
2. Lire le schéma et la documentation du dossier `database`, puis exécuter manuellement le SQL dans le SQL Editor de ce projet vide. Examiner les erreurs avant de poursuivre ; ne pas appliquer ce starter sur une base déjà utilisée.
3. Configurer les comptes Auth, les rôles admin/équipe/client et les règles d’accès. Tester qu’un client ne voit pas les lignes d’un autre. Ne pas contourner ce contrôle avec une clé administrateur dans le navigateur.
4. Mettre les valeurs de votre projet dans la configuration serveur exclue de Git. Les noms historiques attendus sont `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY`. Les clés publiques et secrètes modernes ont des rôles distincts : vérifier leur compatibilité avec le client livré avant migration.
5. Après cette recette uniquement, activer ensemble `LEADFACTORY_DATA_MODE=supabase`, `LEADFACTORY_CONNECT_DATABASE=1` et `NEXT_PUBLIC_LEADFACTORY_DATA_MODE=supabase`, avec les clés de votre projet. Recompiler/redémarrer pour les réglages publics Next.js. Les anciennes API distantes exigent aussi `LEADFACTORY_ENABLE_EXTERNAL=1`. Les connexions et missions du starter restent locales : les tables agents du SQL ne reçoivent pas automatiquement leurs données.

Supabase documente la [création SQL et les politiques RLS](https://supabase.com/docs/guides/database/tables) et les [clés publiques/serveur](https://supabase.com/docs/guides/getting-started/api-keys). Les variables `NEXT_PUBLIC_*` sont accessibles au navigateur ; aucun secret ne doit porter ce préfixe. Le schéma, les règles d’accès et l’authentification doivent être recettés ensemble avant d’utiliser de vraies données. Le RLS fourni est plus strict que l’historique : des requêtes anciennes telles que `select('*')` sur les profils peuvent être volontairement refusées. Ce mode distant n’est pas certifié pour la production ; vérifier et adapter les routes concernées, sans desserrer les protections pour contourner une erreur.

## 5. Connecter Slack

1. Créer une app sur le portail Slack avec votre workspace de test, puis ouvrir **OAuth & Permissions**.
2. Pour de futures notifications, ajouter le scope bot `chat:write`. Ajouter `channels:read` uniquement si vous souhaitez lister les canaux publics. Le test d’identité `auth.test` ne publie aucun message.
3. Installer l’app dans votre workspace. Après un changement de scopes, réinstaller l’app pour mettre à jour les autorisations.
4. Dans **Mes connexions personnelles**, choisir Slack, saisir le **Bot User OAuth Token** puis **Enregistrer mon token**. Il reste côté serveur. Pour une future intégration d’envoi, `SLACK_BOT_TOKEN` et `SLACK_CHANNEL_ID` désignent les variables documentées ; le test du starter n’a pas besoin d’un canal. Inviter le bot dans le canal choisi avant une future publication.
5. Utiliser uniquement la vérification de connexion. Le bouton du starter exécute uniquement `auth.test` ; il ne comprend pas un envoi automatique de messages ni une écoute continue des conversations.

Voir [création de l’app et scopes](https://docs.slack.dev/tools/bolt-js/creating-an-app/), [tokens](https://docs.slack.dev/authentication/tokens/) et [auth.test](https://docs.slack.dev/reference/methods/auth.test/). Ne pas utiliser un token personnel à la place du token bot. Les Events API, commandes et interactions Slack nécessitent un endpoint HTTPS, une validation de signature et un secret de signature : ils ne sont pas activés par le simple test de connexion.

## 6. Connecter Meta pour les campagnes

Créer votre app sur Meta for Developers et attribuer uniquement vos actifs de test. Choisir le cas Marketing API/gestion publicitaire disponible dans votre interface. Dans les paramètres Business, un utilisateur système auquel les actifs sont attribués peut servir à une intégration serveur ; générer le token pour l’app. Dans **Mes connexions personnelles**, choisir Meta, renseigner le token et la version Graph API actuellement acceptée, puis enregistrer. Le test appelle uniquement `/me?fields=id` ; il ne lit pas les campagnes, ne lance pas de synchronisation et ne valide pas `ads_management`. `META_ACCESS_TOKEN` concerne l’adaptateur historique éventuel, configuré séparément.

Commencer par le besoin de lecture `ads_read`. La gestion des campagnes demande `ads_management` et les droits sur le compte publicitaire concerné. La récupération de leads ou de pages nécessite des permissions supplémentaires adaptées au parcours. Les autorisations, niveaux d’accès, examens d’app et justificatifs dépendent du cas Meta. Vérifier les scopes réellement consentis avant toute action ; la source historique demandait plusieurs scopes à la fois et ne constitue pas une recette minimale actuelle.

Pour le parcours OAuth historique : `FB_APP_ID`, `FB_APP_SECRET`, `META_REDIRECT_URI`, éventuellement `META_LOGIN_CONFIG_ID` et `META_GRAPH_VERSION`. Le callback du code est `/api/meta/auth/callback`. Définir l’URL exacte de votre propre domaine dans Meta et dans la configuration, garder le contrôle `state`, et vérifier signature et destination avant les webhooks. Choisir explicitement une version Graph API actuellement supportée ; ne pas s’appuyer sur le défaut ancien du code source.

Première recette : afficher les comptes autorisés, choisir le compte de test, lire ses métriques, préparer une campagne **en brouillon ou en pause**, vérifier budget, devise, fuseau, objectif, événements et créatives. Activer une campagne et dépenser un budget constituent une étape séparée. Aucun compte d’origine, token, pixel ou Page de l’agence n’est fourni.

Références officielles à consulter : [démarrage Marketing API](https://developers.facebook.com/docs/marketing-api/get-started/), [utilisateurs système](https://developers.facebook.com/docs/marketing-api/businessmanager/systemuser/), [permissions](https://developers.facebook.com/docs/permissions/) et [sécurité OAuth](https://developers.facebook.com/docs/facebook-login/security/). **Limite de vérification au 1er octobre 2026 : ces pages ont renvoyé une restriction/HTTP 429 pendant cette préparation ; les noms des variables et le callback ont été observés dans le code, mais le parcours exact actuel doit être confirmé dans votre console Meta.**

## 7. Voix et créatives motion design

Le skill [agency-meta-motion-ad](../../skills/agency-meta-motion-ad/SKILL.md) part du site public, d’une charte et de fichiers que le client est autorisé à utiliser. Il prépare une publicité Meta verticale 1080 × 1920 avec narration, typographie animée, storyboard et contrôles de lisibilité. Le script, les preuves et les droits des assets doivent être validés avant le rendu.

Créer sa propre clé ElevenLabs, l’enregistrer dans **Mes connexions personnelles → ElevenLabs**, puis utiliser le test d’accès au compte. Ce test ne synthétise aucune voix. Choisir ensuite une voix disponible et autorisée. Le helper motion design utilise `ELEVENLABS_API_KEY` dans son propre environnement : un test de compte dans le cockpit ne lui transmet pas automatiquement la clé. Une voix clonée exige l’accord du titulaire ; aucune voix personnelle n’est incluse. Le helper livré reste en simulation par défaut. Un appel réel génère de l’audio facturé selon votre compte ; le rendu motion reste une étape distincte. Les timings permettent de synchroniser texte et voix. Voir [Quickstart](https://elevenlabs.io/docs/eleven-api/quickstart/) et [synthèse avec timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps).

## 8. Email, CRM et sources complémentaires

Le CRM peut être préparé avec une entreprise fictive, ses étapes et des tâches sans connecter de messagerie. La source comprend des chemins SMTP, Brevo et Resend : choisir un seul fournisseur adapté et vérifier le chemin réellement utilisé avant d’activer les emails transactionnels. Les secrets possibles figurent dans le catalogue. Pour Resend, vérifier son propre domaine et les DNS demandés ; voir [domaines vérifiés](https://resend.com/docs/dashboard/domains/introduction). Préparer séparément le domaine d’envoi commercial, les exclusions, la gestion des réponses et les plafonds dans les skills Cold Email.

La présence d’un SMTP ou d’un outil de séquences ne signifie pas qu’une campagne de prospection est active. D’abord prévisualiser destinataires, objet, texte, variables manquantes et exclusions avec des données fictives. Un test avec message réel exige une destination de test choisie et une action d’envoi distincte. Ne jamais récupérer les listes de clients de l’agence d’origine.

Des adaptateurs historiques existent aussi pour Google Ads, LinkedIn, Apify, Notion, Fathom, Gemini et Fal. Leur présence est indiquée comme **source disponible, configuration et recette nécessaires** dans le catalogue. Les anciens relais, automatisations et crons n’ont pas à être reconnectés. Tout webhook futur doit viser votre propre endpoint, vérifier son secret/signature, limiter les données et gérer les doublons. Ne pas remettre une URL historique par défaut.

## 9. Recette du starter et déploiement

Pour une vidéo de démo : utiliser uniquement les exemples fictifs. Montrer Dashboard → Équipe → formulaire → brief → proposition → créatives → campagne en préparation → reporting vide ou explicitement simulé. Distinguer une proposition générée d’une campagne diffusée, et une carte d’intégration d’une connexion vérifiée.

Avant un usage réel, vérifier au minimum : accès admin/équipe/client ; séparation entre deux clients fictifs ; formulaire incomplet refusé ; double soumission sans doublon ; trace du rôle, du fournisseur et de la version du livrable ; arrêt du traitement ; absence de secrets dans exports et logs ; envoi et publication toujours explicites. Le test Slack doit rester sans message, Meta sans changement de budget, et email sans envoi.

Les intégrations historiques et le mode distant restent fermés par défaut ; leur activation demande `LEADFACTORY_ENABLE_EXTERNAL=1` et leur propre configuration. En mode local, les boutons de test de compte et les missions IA sont des actions explicites : le premier vérifie seulement un accès, les secondes consomment l’usage de votre fournisseur. Aucun cron ni agent permanent n’est installé.

**Ce starter local ne doit pas devenir un portail public par simple tunnel ou proxy.** Il utilise une identité administrative fictive et des aperçus client. Le déploiement public et le mode Supabase ne sont pas certifiés : ils exigent un chantier distinct d’authentification réelle, d’autorisation de chaque route, de compatibilité avec le RLS strict, de Storage, de callbacks et de sauvegarde de sa propre base. Le CLI personnel reste attaché à sa machine ; un conteneur ou serveur distant n’en hérite pas. Le logiciel et ses archives restent privés ; aucune donnée d’origine n’est connectée.

## Traçabilité

Observation directe : routes et noms de variables du logiciel source, révision `e909784b7a28982825b3a1b4d7ee0ff8b27e9bf1` ; roster et skills du pack, lecture du 1er octobre 2026. Les secrets et les fichiers `.env` sources n’ont pas été utilisés pour ce guide. Documentation fournisseur consultée ce jour : Slack, Supabase, Codex, Claude Code, OpenRouter, ElevenLabs et Resend. Limite Meta détaillée plus haut. Les autres références du catalogue sont des points d’entrée officiels, pas des preuves de tests de connexion. Aucun tutoriel YouTube arbitraire n’a été ajouté : les procédures officielles sont reliées directement à chaque étape.
