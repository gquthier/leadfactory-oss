# Contrat du script de polling

## Entrées

`--env <fichier>` (variables ci-dessus) · `--test` (un message de test, puis sortie) · `--seed` (marquer l'existant comme vu) · `--notify-existing` (notifier aussi l'historique) · `STATE_FILE` (JSON, ensemble des `leadgen_id` vus) · `CLIENT_NAME` (en-tête du message).

## Boucle

1. Obtenir le jeton de Page : `GET /{PAGE_ID}?fields=access_token`.
2. Pour chaque `form_id` : `GET /{form_id}/leads?fields=id,created_time,field_data&limit=100` (paginer si `paging.next`).
3. Charger l'état. Premier run sans état → écrire tous les ids, ne rien notifier (sauf `--notify-existing`).
4. Pour chaque lead absent de l'état : construire le message, envoyer, **puis seulement** ajouter l'id à l'état. En cas d'échec d'envoi, ne pas ajouter (retenté au run suivant).
5. Écrire l'état de façon atomique (fichier temporaire puis renommage). Journal append-only (`notif.log`), sans données sensibles au-delà du nécessaire.

## Message

```
Nouveau lead — {CLIENT_NAME} · formulaire {form_name}
Nom : … · Email : … · Téléphone : … · Société : …
Réponses : {question → réponse, pour chaque champ de qualification}
Reçu : {created_time}
```

Mapper les clés connues (`full_name`, `email`, `phone_number`, `company_name`) vers des libellés français ; toute clé inconnue est affichée telle quelle avec sa valeur.

## Destinations

Slack : `POST https://slack.com/api/chat.postMessage` (`channel`, `text`) ; erreur `not_in_channel` → message clair dans le journal. Webhook : `POST WEBHOOK_URL` avec le payload normalisé. Email : SMTP de l'utilisateur.

## Planificateur

launchd : `Label com.lead-notif.{client}`, `ProgramArguments [python3, script, --env, fichier]`, `StartInterval 180`, `RunAtLoad true`, `StandardOutPath/StandardErrorPath` vers le dossier d'état. Cron : `*/3 * * * * python3 <script> --env <fichier>`.
