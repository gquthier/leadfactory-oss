# Base vide du logiciel LeadFactory

Lecture et validation : **1 octobre 2026**. Source : structures des 44 migrations et requêtes TypeScript du logiciel interne au commit `e909784`. Statut : bootstrap reconstruit et testé dans PostgreSQL en mémoire ; aucune base de données existante n'a été consultée ou connectée.

Le schéma couvre **50 tables et 597 colonnes** : profils et équipe, campagnes, onboarding, tâches, CRM, leads, finance, formations, SOP, livrables, crédits, générations IA, appels et connecteurs. Il ne contient aucun compte, client, prospect, contenu de formation, historique, token ou donnée métier. Les anciennes migrations de rattrapage, attributions d'administrateur et crédits gratuits ont été retirées.

## Installation sur votre nouvelle base, lorsque vous le décidez

1. Créer un **nouveau projet Supabase vide**, indépendant de toute base déjà utilisée. Ce dossier ne crée ni ne relie un projet.
2. Dans son SQL Editor, appliquer dans cet ordre [001_schema.sql](001_schema.sql), [002_source_alignment.sql](002_source_alignment.sql), [003_access.sql](003_access.sql), puis [004_starter_agents.sql](004_starter_agents.sql). Garder l'application fermée jusqu'à la fin des quatre fichiers. On peut appliquer à la place [schema.sql](schema.sql), qui regroupe ces quatre étapes dans une seule transaction ; ne pas appliquer les deux formes. Ce bootstrap n'est pas une migration de mise à jour : ne pas le rejouer sur une base peuplée.
3. Supabase doit fournir `auth.users`, `auth.uid()`, les rôles `anon`, `authenticated` et `service_role`. `gen_random_uuid()` est fourni par PostgreSQL récent. Les fonctions et déclencheurs sont créés par le propriétaire du schéma. Le script ne crée ni compte Auth ni mot de passe.
4. Créer votre propre premier utilisateur dans Supabase Auth, puis promouvoir **uniquement cet utilisateur** dans le SQL Editor. Remplacer la valeur factice ci-dessous par son UUID vérifié ; aucun identifiant d'origine n'est fourni.

```sql
UPDATE public.profiles
SET role = 'admin', team_role = 'super_admin',
    team_status = 'active', is_super_admin = true, is_active = true
WHERE id = 'REMPLACER_PAR_UUID_DE_VOTRE_UTILISATEUR'::uuid;
```

5. Configurer votre nouvelle URL et vos nouvelles clés dans l'environnement local du serveur selon le Start Here. `service_role` reste exclusivement côté serveur, jamais dans une variable `NEXT_PUBLIC_*`, un navigateur ou un prompt d'agent. Le schéma ne fait aucun appel à Slack, Meta ou un fournisseur IA.
6. Si ces fonctions sont utilisées, créer les buckets **privés** `ai-deliverables` et `scraper-csvs` dans Storage. Conserver les objets privés et délivrer les téléchargements depuis une route serveur qui vérifie le propriétaire puis génère une URL signée courte. Aucune politique publique Storage ni bucket n'est installé ici.
7. Tester avec deux comptes fictifs distincts et un administrateur sur votre nouvelle installation avant toute donnée réelle. Les profils clients démarrent à **zéro crédit** : un administrateur attribue explicitement un budget dans l'application. Aucune campagne, publication, synchronisation ou tâche planifiée n'est activée par ce SQL.

## Différences intentionnelles avec l'ancien SQL

- Les anciens droits permettant à un client de modifier son propre `role`, d'insérer librement de l'onboarding ou d'accéder aux tables de tokens ne sont pas repris.
- Toutes les tables ont RLS. Les écritures passent par les routes serveur, qui doivent authentifier la requête, vérifier l'autorisation et valider chaque champ **avant** d'utiliser `service_role`. Cette clé contourne RLS : le schéma ne compense pas une route serveur mal protégée.
- Les champs historiques `profiles.gemini_api_key`, `profiles.meta_access_token` et `meta_tokens.token` existent uniquement pour compatibilité. Ils sont vides et non lisibles par le navigateur. Les deux premiers sont exclus des droits SELECT du profil ; une requête navigateur `select('*')` sur `profiles` échouera volontairement. Utiliser une liste de colonnes non sensibles ou une route serveur qui masque les secrets. Les nouveaux connecteurs chiffrés utilisent les champs `*_encrypted`, avec leur clé de chiffrement hors base et hors Git.
- Les clients lisent leurs propres lignes ; les administrateurs actifs de l'agence lisent les opérations. Les tables de clés, tokens et payloads de webhook restent accessibles exclusivement au serveur. Les formations et SOP requièrent une attribution.
- Ce bootstrap correspond à **une seule agence par projet**, pas à l'isolation de plusieurs agences concurrentes. Les contrôles fins de rôle d'équipe et les écritures sont assurés dans le serveur ; ils restent à vérifier sur une installation réelle.
- Aucun cron, publication automatique, webhook externe, bucket, crédit gratuit ou utilisateur n'est créé. Les déclencheurs locaux de profil, notifications et dates de mise à jour sont conservés ; ils ne font aucun appel réseau.

## Alignement avec le code retrouvé

[002_source_alignment.sql](002_source_alignment.sql) reconstruit les éléments appelés par le code mais absents des migrations commitées : `client_tasks`, `linkedin_connections`, `scheduled_posts`, `post_publish_attempts`, `profiles.next_catchup`, l'ancien token Meta de profil, `campaigns.weekly_report_enabled`, l'attribution client des dépenses et deux champs de livrables. `ai_deliverables.type` est un alias généré de `deliverable_type` ; `content` est finalisé en TEXT par 004 et reste vide tant qu'un pipeline ne le renseigne pas. Les usages des crédits cold call et Reels ont été ajoutés au CHECK. L'énumération des campagnes accepte les états canoniques actuels et les états historiques reconnus par le code.

La structure de ces ajouts est **déduite des requêtes source**, pas observée dans une base de production. Des valeurs de référence génériques de pipeline existent uniquement dans une fonction serveur ; elles ne sont pas exécutées au bootstrap.

## Agents recrutés, sources et missions

[004_starter_agents.sql](004_starter_agents.sql) ajoute `agency_agents`, `agent_sources` et `agent_runs`, ainsi que le texte des livrables et les champs facultatifs `provider`, `model` réellement retourné et `requested_model`. [starter-agent-mapping.json](starter-agent-mapping.json) décrit chaque correspondance avec `src/lib/starter-agents.ts`.

**Le runtime reste local : `.local-data/agents.json` n'est pas synchronisé avec ces tables.** Ce dossier fournit le contrat SQL pour une future intégration, pas un adaptateur actif ni une importation des fichiers locaux. Le roster, les prompts et les skills restent dans les fichiers versionnés du starter. Les URL des sources sont des références, sans visite automatique.

Les trois nouvelles tables sont réservées au serveur, sans droits directs `anon`/`authenticated`. Une route serveur doit vérifier un administrateur actif avant chaque accès, puis vérifier le client et les sources de la mission. Une seule mission SQL peut être `queued`/`running` à la fois, et un onboarding ne peut créer qu'une mission. Un déclencheur rejette une campagne, un onboarding ou une source appartenant à un autre client lors de leur affectation. Les étapes conservent la réponse, l'usage et le modèle réellement retourné ; le modèle demandé reste distinct. Les identifiants des sources supprimées peuvent rester dans un historique : revérifier le contenu disponible lors d'une nouvelle exécution.

Le texte `ai_deliverables.content` est un corps Markdown/texte nullable. L'affichage de ce corps n'autorise aucune lecture depuis `relative_path`, qui reste une métadonnée historique. Les champs de provider/modèle ne contiennent aucune clé. Aucun agent, source, mission ou livrable n'est prérempli par SQL.

Pour régénérer le fichier regroupé après une modification des fragments : `node build-schema.mjs`.

## Preuves et limites

- [validation-report.json](validation-report.json) : application des quatre fichiers et, indépendamment, du fichier regroupé `schema.sql` dans PGlite/PostgreSQL en mémoire, 50 tables vides, RLS partout, isolation de deux profils/campagnes fictifs, refus de promotion de rôle, lecture de tokens, création de crédits et RPC privilégiée ; accès anonyme refusé.
- [source-coverage.json](source-coverage.json) : les 46 noms de tables littéraux utilisés dans TS/TSX existent ; 1 416 références littérales de colonnes contrôlées, aucune manquante.
- [write-coverage.json](write-coverage.json) : 499 propriétés d'objets littéraux passés à insert/update/upsert contrôlées via l'AST TypeScript, aucune manquante.
- [source-map.json](source-map.json) : provenance des structures et exclusions. [rebuild-schema.py](rebuild-schema.py) permet de régénérer le premier fichier à partir d'un dossier local de migrations, sans connexion réseau ou SQL.

Ces contrôles n'émulent pas Supabase Auth, PostgREST, Storage, les cookies, le navigateur ou les fournisseurs externes. Les requêtes dynamiques, jointures imbriquées et objets construits à l'exécution ne sont pas tous vérifiés par l'audit statique. Ce résultat prouve la syntaxe/cohérence PostgreSQL et les cas RLS testés, pas le fonctionnement intégral de tous les parcours en production.

Pour reproduire dans un environnement de test Node disposant de `@electric-sql/pglite`, exécuter `node validate-schema.mjs`. On peut aussi fournir `PGLITE_MODULE` pointant vers son fichier d'entrée. La base de test reste exclusivement en mémoire ; aucune URL de base ni variable Supabase n'est lue. Pour les audits statiques : `python3 audit-source.py CHEMIN_DU_SRC` et `node audit-writes.mjs CHEMIN_DU_SRC` avec TypeScript installé (ou `TYPESCRIPT_MODULE` pointant vers son module local).
