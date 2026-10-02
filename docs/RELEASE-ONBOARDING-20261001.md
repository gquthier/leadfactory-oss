# Onboarding, proposition et motion Meta — 1er octobre 2026

**Statut : source privée, démo autonome locale.** Product : `local-bizos-oss` (extension du pack Agency autonome). Execution : Node.js mono-instance, base JSON sur disque, appels OpenRouter personnels facultatifs ; aucun moteur BizOS cloud. Data-owner : workspace Agency choisi. Capabilities : portail client borné, rédaction en quatre rôles, proposition partagée par l’opérateur ; pas d’email, publicité ou rendu vidéo automatique.

## Ce qui change

Le logiciel contenait un questionnaire local sans lien client ni déclenchement IA. Il offre maintenant un portail séparé par lien individuel, brouillon reprenable, cinq étapes et dix champs requis. Une soumission valide écrit dans une transaction réponses, brief, campagne, tâches et une seule mission. La chaîne Onboarding → Creative Strategist → Media Buyer → Communication client produit un draft de proposition. Le partage copie le livrable relu dans le portail ; les changements ultérieurs du questionnaire invalident sa présentation.

Huit templates d’agents, **39 skills Agency + 12 modules créatifs optionnels**, 98 associations. Communication client rejoint l’équipe. Le skill de proposition abandonne les interdictions de KPI et les structures publicitaires universelles. Un template JSON du formulaire est généré depuis le schéma réellement servi.

`agency-meta-motion-ad` guide une publicité Meta 9:16 depuis site/charte/assets, avec voix ElevenLabs, timings et composition dynamique. Préférence utilisateur **Opus 5.5**, corrigée depuis la transcription « OpenCLaw 2.5 ». Helper voix Python et brief de motion fournis ; aucun média, voix personnelle ou rendu factice inclus.

## Preuves

- 134 tests Node du kit ; 79 tests ciblés runtime ; build TypeScript.
- 14 tests Python outbound et 3 tests Python voix synthétique.
- Nouvelle chaîne et soumission partagée : couverture ciblée observée 100 % lignes, 83,57 % branches, 98,46 % fonctions. Ce périmètre n’est pas la couverture globale du produit.
- Recette navigateur isolée : client fictif créé, lien émis, cinq étapes remplies, soumission, mise à jour du cockpit, quatre sorties démo, partage, lecture client. Aucune erreur JavaScript de page. Test rejouable : `test-e2e/onboarding.mjs`.
- Validation structurelle du skill motion et du skill proposition. Docker Compose : configuration parsée ; conteneurs et HTTPS distant non déployés.

Tests comportementaux : token/host/origin, séparation client/admin, révocation, expiration, double soumission, provider en erreur, STOP et réponse tardive, redémarrage sans retry ambigu, import sans liens actifs, dossier modifié refusé au partage. Le mode démo est déterministe ; les appels IA du test utilisent un transport simulé. Le helper ElevenLabs a été testé sans connexion payante.

## Limites d’exécution

Aucun appel IA facturable, audio ElevenLabs réel, MP4 client, email, dépense média ou déploiement Internet effectué. Le mode IA de production utilisera la connexion personnelle configurée, distincte du runtime d’agents BizOS. Il ne crée pas quatre conversations dans BizOS Simple. L’app installée n’a pas été modifiée ou certifiée.

Le CLI Claude Code restait indisponible d’après l’échec de quota observé dans cette session (aucun modèle exécuté rapporté, coût 0). Implémentation réalisée directement par Codex ; aucune revue indépendante annoncée. Les prompts de motion recommandent Opus 5.5, ce qui ne prétend pas qu’il a été exécuté ici.

[Guide de démo et déploiement](DEMO-ONBOARDING.md) · [Formulaire](../templates/onboarding-form.json) · [Agents](../agents/README.md) · [Motion Meta](../skills/agency-meta-motion-ad/SKILL.md).
