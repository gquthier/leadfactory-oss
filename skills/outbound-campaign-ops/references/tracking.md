# Journal d’événements hors ligne

Python 3, bibliothèque standard. Une base privée par client/expéditeur ; les exclusions sont globales seulement dans cette base. Résoudre les chemins depuis ce skill.

```sh
python3 references/tracking.py.txt --db campaign.sqlite ingest --input events.json
python3 references/tracking.py.txt --db campaign.sqlite report
```

Chaque événement fourni possède `provider`, `event_id`, `campaign_id`, `account_id` (entreprise prospectée), `email`, `event_type`, `occurred_at` avec fuseau et `evidence`. Types : accepted, delivered, replied, positive_reply, out_of_office, soft_bounce, hard_bounce, opt_out, complaint, meeting_booked, meeting_held, quote_sent, order_paid, reorder_paid. Sources normalisées après vérification de l’export/provider ; un webhook brut non authentifié n’est pas une preuve.

L’ingestion est transactionnelle et idempotente par provider/event_id ; collision de contenu rejetée. Réponse et bounce bloquent le suivi dans le journal ; plainte/opposition/hard bounce sont inscrits dans les exclusions. **Le script ne propage pas ces arrêts au fournisseur** : Cold Email doit exécuter et vérifier les arrêts réels dans le connecteur autorisé. Il ne reçoit pas les webhooks, n’envoie rien et ne planifie rien. Les comptes et événements sont des données privées, exclus des templates et des archives.
