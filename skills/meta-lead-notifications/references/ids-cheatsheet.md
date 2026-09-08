# Où trouver chaque identifiant (méthode, aucune valeur)

| Quoi | Variable | Où |
|---|---|---|
| Jeton System User | `META_ACCESS_TOKEN` | Business Manager → Paramètres → Utilisateurs système → créer ou choisir (rôle admin) → Générer un jeton → scopes `leads_retrieval`, `pages_manage_ads`, `pages_read_engagement`, `pages_show_list` → sans expiration. Attribuer la Page du client à ce System User. |
| Page ID | `PAGE_ID` | Page Facebook → À propos → ID de la Page ; ou `GET /me/accounts` avec le jeton System User. |
| Form ID(s) | `FORM_IDS` | Ads Manager → colonne Formulaire ; Meta Business Suite → Outils de publication → Formulaires ; ou `GET /{page_id}/leadgen_forms?fields=id,name,status` avec le jeton de Page. |
| Jeton de Page | dérivé | `GET /{page_id}?fields=access_token&access_token=<jeton System User>`. |
| Version Graph | `META_GRAPH_VERSION` | version supportée vérifiée dans le changelog officiel Graph API et compatible avec le connecteur. |
| Jeton Slack | `SLACK_TOKEN` | api.slack.com/apps → OAuth & Permissions → Bot Token Scopes `chat:write` → Install to Workspace. Un jeton par espace de travail. |
| Canal Slack | `SLACK_CHANNEL` | clic droit sur le canal → Voir les détails → ID en bas (`C…`) ; inviter le bot (`/invite @bot`). |
| Webhook CRM | `WEBHOOK_URL` | route d'ingestion de leads du CRM de l'utilisateur (documentation du CRM). |
| SMTP | `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | fournisseur transactionnel de l'utilisateur. |
| App Meta (webhook temps réel seulement) | `FB_APP_ID`, `FB_APP_SECRET`, `META_VERIFY_TOKEN` | developers.facebook.com → app → Paramètres ; le verify token est une chaîne choisie par l'utilisateur. |

Si l'utilisateur a déjà une application qui stocke ces variables, il les copie lui-même dans le fichier `.env` du client.
