# Connecter son IA personnelle

Mis à jour le **1er octobre 2026**. Le dépôt et les archives restent privés.

Le cockpit peut appeler **Claude Code ou Codex déjà installé et connecté sur la même machine**. Aucune clé API n’est demandée pour ce parcours. Les identifiants restent gérés par le CLI ; LeadFactory ne lit ni ne copie ses fichiers de connexion. Le traitement du texte passe par le fournisseur du CLI et les limites du compte s’appliquent : local ne signifie pas modèle hors ligne.

1. Dans votre terminal, vérifier `codex --version` ou `claude --version`. Installer ou mettre à jour le CLI depuis son éditeur si nécessaire.
2. S’il n’est pas connecté : `codex login` ou `claude auth login`.
3. Dans le dossier LeadFactory, lancer `npm run demo` depuis ce terminal.
4. **Start Here → IA personnelle → Codex ou Claude Code → Vérifier et connecter mon CLI**. Le modèle est facultatif : vide utilise le défaut du CLI, un identifiant précis est transmis tel quel. Les personnalisations utilisateur ne sont pas chargées pour ces missions de rédaction. Aucun modèle de remplacement n’est sélectionné après une erreur.
5. Créer un client, puis son lien en mode **Agents IA**. La fin du formulaire déclenche les quatre rôles. Garder l’ordinateur et le processus ouverts. Relire puis partager la proposition.

La vérification contrôle installation, options requises et état de connexion ; elle ne génère rien et ne garantit ni quota disponible ni accès au modèle choisi. Le choix du CLI et du modèle est figé à la création du lien. Un changement ultérieur concerne les nouveaux liens et la rédaction manuelle. OpenRouter reste une alternative facultative dans un panneau séparé.

## Exécution

Chaque rôle reçoit son prompt système, son skill principal, le questionnaire de ce seul client et les résultats précédents. Un nouveau processus est lancé, sans shell, dans un répertoire temporaire vide ; le prompt passe par stdin, pas dans la liste des processus. Claude utilise le mode sûr, sans outils ni MCP, sans persistance de session. Codex ignore la configuration personnelle, garde l’authentification, utilise le sandbox en lecture seule, désactive shell, recherche web et apps, et ne persiste pas sa session. Les politiques administrées par l’éditeur continuent de s’appliquer. Ce lancement restreint n’est pas un sandbox multi-utilisateur du système d’exploitation.

Quatre exécutions séquentielles maximum par formulaire, trois minutes maximum chacune, sortie processus limitée à 1 Mo et livrable à 30 000 caractères. Claude reçoit aussi un budget API de 2 USD par rôle ; ce paramètre ne convertit pas les limites d’un abonnement en dollars. Codex ne fournit pas ici de plafond monétaire ; son usage dépend du compte. OpenRouter garde sa limite de 2 000 tokens de sortie par appel. Aucun retry applicatif automatique ni substitution par un texte de démo. STOP termine le processus actif et refuse ses résultats tardifs.

Le suivi conserve fournisseur, modèle demandé, modèle réellement communiqué et usage disponible. Codex peut ne pas indiquer son modèle dans le flux JSON : il reste alors « non communiqué », sans présenter le modèle demandé comme une preuve. Les messages d’échec n’exposent pas les logs bruts du CLI.

## Hébergement

Le navigateur peut être distant, mais **le serveur du cockpit et le CLI doivent être sur la même machine et sous le même utilisateur connecté**. Un conteneur Docker ou serveur distant n’hérite pas du CLI ni de la connexion de votre Mac. Le déploiement Docker fourni fonctionne en démo ou avec la connexion API facultative ; pour le CLI personnel, lancer Node sur sa machine et exposer uniquement le portail via un reverse proxy HTTPS correctement configuré. Ne pas copier son profil d’authentification dans l’image ou l’archive.

La connexion des modèles d’agents dans l’app BizOS actuelle reste distincte. Cette livraison ne modifie pas l’app installée.

## Vérifications du 1er octobre 2026

Sur la machine de développement : Codex CLI **0.155.1** et Claude Code **2.1.286** détectés, options compatibles, sessions connectées. Un vrai appel Codex sur un brief fictif a produit une phrase : 14 174 tokens d’entrée, 27 de sortie, dont 2 304 tokens d’entrée en cache selon le CLI ; modèle non communiqué. Ce n’est pas une recette de campagne complète. Aucun appel Claude ajouté à cette recette.

Tests automatisés : parsing, limites, timeout, arrêt d’un vrai sous-processus fictif, connexion sans clé, quatre rôles avec adaptateur simulé, choix figé par invitation, erreurs de connexion, import et redémarrage. La recette navigateur peut être rejouée avec `CLI_FIXTURE=1 node test-e2e/onboarding.mjs` (adaptateur explicitement simulé, pas preuve de qualité d’un modèle).

Références vérifiées : aide locale des deux versions installées et [configuration officielle Codex](https://learn.chatgpt.com/docs/config-file/config-reference). Les versions anciennes dépourvues des options requises sont refusées et doivent être mises à jour.
