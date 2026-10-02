# Équipe d’agence privée — 1er octobre 2026

Statut : sources locales, aucune publication ou activation. Cette livraison prolonge l’[extension créative](RELEASE-20261001.md) et porte le template Agency de v3 à v4. Les installations existantes ne sont pas migrées.

## Livré

Sept prompts complets : CEO, Acquisition, Onboarding, Delivery, Media Buyer, Cold Email, Creative Strategist. Chaque rôle dispose de ses compétences, entrées, outputs, critères de fin et passations. Les sources canoniques sont dans `agents/` ; un générateur produit les prompts autonomes, le JSON générique, les notes du vault et le roster natif. L’ancien jeu de rôles est conservé dans `docs/history/`.

38 skills métier et 12 modules créatifs optionnels ; 91 associations entre rôles et compétences. Les neuf nouveaux skills sont des méthodes réutilisables réécrites depuis les sources locales examinées. Deux utilitaires Python de prospection/suivi sont repris avec tests et exemples synthétiques. Les hypothèses commerciales, droits et dépendances restent explicites.

L’[audit](SKILL-AUDIT.md) distingue 403 noms repérés, revue ciblée, preuves historiques et tests locaux. Le compteur de noms ne signifie pas que 403 skills sont opérationnels ou redistribuables.

## Validation

- 125 tests du kit réussis : cockpit, installateur, export, cohérence des notes et des sept prompts/skills.
- 79 tests runtime ciblés réussis : Agency/kit (33) et templates (46). Build TypeScript réussi. Le nouveau test vérifie que les six prompts complets et les deux utilitaires voyagent dans les notes natives, avec routage réel et sans injection du moteur créatif optionnel.
- 14 tests Python hors réseau réussis : extraction, classification, dry run, préservation de sortie, déduplication, rollback, arrêts et exclusions, séparation des bases clients.
- Neuf nouveaux SKILL.md et le launcher Meta révisé passent le validateur structurel. Aucune création de campagne, vérification email payante ou nouvelle vidéo exécutée.

Les tests ont aussi détecté des liens de rôles mal interprétés par le graphe natif ; ils ont été corrigés. Les attentes des tests correspondant à l’ancien roster ont été actualisées. Ce sont des tests de logiciel et de packaging, pas une évaluation terrain de la performance des agents.

L’export natif conserve CEO seul au démarrage et six spécialistes disponibles sur mission. Les checksums et la révision source exacte sont inscrits dans l’export final. Le format JSON autonome n’est pas présenté comme un import universel d’agent.

## Limites

La version actuellement installée de BizOS Simple n’a pas été testée ni modifiée. Connecteurs, budget publicitaire, sender email et moteur vidéo sont à configurer. Aucun push, envoi, dépense ou agent actif créé. Le dépôt reste privé.

Le CLI Claude Code a été essayé dans le chantier précédent de cette session ; la limite hebdomadaire empêchait son exécution, avec coût déclaré nul et aucun modèle exécuté rapporté. Ces adaptations ont été traitées directement par Codex ; aucune revue indépendante ni économie mesurée n’est revendiquée.
