# Collecter et vérifier

Python 3, bibliothèque standard. Exécuter depuis le dossier du skill ou adapter le chemin ; le suffixe `.py.txt` permet le transport par le chargeur natif et Python peut l’exécuter.

```sh
python3 references/prospects.py.txt collect --input accounts.json --output collected.json --max-pages 20
python3 references/prospects.py.txt verify --input contacts.json --output verified.json --max-requests 20
```

Collecte : tableau d’objets `account_id`, `company`, `urls`. URLs publiques officielles contrôlées préalablement. Vérification : objet `contacts` contenant un tableau avec `account_id`, `company`, `email`, `source_url`, `observed_at` et `verification_status`. La deuxième commande ne fait aucun appel réseau sans `--live` ; la sortie n’est pas écrite en dry run. Consulter la documentation actuelle Hunter avant usage live ; `HUNTER_API_KEY` doit être configurée sans être placée dans le chat, un template ou Git.

Le script borne 1–100 pages/requêtes et conserve l’entrée. Sortie nouvelle obligatoire. Les résultats 202/pending restent en attente ; les erreurs d’auth/quota arrêtent le lot. Ce pilote n’a ni cache ni reprise de crawling à grande échelle. Les contrôles réseau locaux ne sont pas une isolation réseau générale face à un environnement hostile.

Le ledger d’`outbound-campaign-ops` reçoit les événements normalisés fournis. Il ne pilote aucun fournisseur. Garder une base distincte par client/expéditeur autorisé.
