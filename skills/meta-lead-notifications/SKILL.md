---
name: meta-lead-notifications
description: Met en place une notification (Slack, email ou webhook CRM) à chaque nouveau lead d'un formulaire Meta Lead Ads, par interrogation périodique de l'API Graph avec un état des leads déjà vus, sans webhook à héberger. À utiliser pour "préviens-moi à chaque nouveau lead Meta", "notif Slack lead", "brancher les leads Meta sur le CRM" ; pas pour créer la campagne (meta-campaign-launcher).
---

# Meta Lead Notifications

Approche **polling** : un script lancé toutes les ~3 minutes par un planificateur (launchd sur macOS, cron sur Linux, tâche planifiée) lit `/{form_id}/leads`, compare à un fichier d'état, et notifie les nouveaux. Marche dès qu'on a un jeton System User (`leads_retrieval`, `pages_manage_ads`) et une destination de notification. Le webhook `leadgen` temps réel exige une app Meta validée et un endpoint public : variante à documenter seulement si l'utilisateur la demande.

## Prérequis (fournis par l'utilisateur, jamais collés dans la conversation)

`META_ACCESS_TOKEN`, `PAGE_ID`, `FORM_IDS`, et selon la destination `SLACK_TOKEN` (bot `chat:write`, bot invité dans le canal) + `SLACK_CHANNEL`, ou un `WEBHOOK_URL`, ou une config SMTP. Où trouver chaque identifiant : [references/ids-cheatsheet.md](references/ids-cheatsheet.md). Secrets dans un fichier `.env` par client (`chmod 600`) hors de tout dépôt.

## Ce que le skill produit

1. Un script de polling écrit **sur mesure dans l'environnement de l'utilisateur** (Python 3 ou Node, sans dépendance externe) respectant le contrat de [references/polling-contract.md](references/polling-contract.md) : jeton de Page dérivé du jeton System User, lecture des leads, état idempotent, message formaté, gestion d'erreur sans perte.
2. La configuration du planificateur (gabarit launchd ou ligne cron) avec le chemin du script, du fichier d'env et du fichier d'état.
3. Une fiche d'instance `{CLIENT_DIR}/09-notifications/fiche-instance.md` : canal, formulaires, page, emplacement des secrets et des logs, date de mise en service.

## Mise en service

1. Écrire le script et le fichier d'env (valeurs à remplir par l'utilisateur).
2. Test : `--test` envoie un message de test et sort.
3. Seed : le premier run normal marque les leads existants comme vus **sans notifier** (pas de rafale d'historique) ; `--notify-existing` pour forcer.
4. Charger le planificateur (`launchctl load` ou crontab) ; intervalle 180 s, exécution au chargement.

## Garde-fous

Jeton jamais imprimé (« jeton chargé ») · premier run silencieux · `not_in_channel` → inviter le bot, le run suivant rattrape · une erreur de notification n'efface pas l'état du lead non notifié · données de leads = données personnelles : fichier d'état et logs restent locaux, pas de copie dans le dossier partagé sans accord.

## Extensions (sur demande)

Push CRM par webhook générique (payload normalisé `name`, `email`, `phone`, `company`, `form_id`, `lead_id`, `created_time`, `answers[]`, dédoublonné par `lead_id`) · email via le transport SMTP de l'utilisateur · webhook temps réel · injection dans un funnel maison.
