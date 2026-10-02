# Enrichissement email (France) — nom → domaine → email

Aucune source publique française ne donne l'email directement. Pipeline en 6 étapes, du gratuit vers le payant.

| Étape | Approche | Pourquoi | Coût |
|---|---|---|---|
| A. Désambiguïsation | API Recherche Entreprises (ville, CP, dirigeant) | évite les homonymes (une clinique d'une autre ville ou d'un autre pays) | gratuit |
| B. Résolution du domaine | instance SearXNG auto-hébergée (prioritaire) → `ddgs` (gratuit, sans clé) → API de recherche payante si l'utilisateur en a une | pas de rate-limit, aucune clé | gratuit ou existant |
| C. Scoring du domaine | code maison | ne jamais prendre la première URL : liste noire des annuaires, vérification du nom et de la ville dans le titre | gratuit |
| D. Extraction | crawler léger (Scrapy, ou fetch + regex) sur home, `/contact`, `/mentions-legales`, avec throttling | rapide, scalable, l'email est en HTML statique dans la quasi-totalité des cas | gratuit |
| E. Nettoyage | liste noire | placeholders (`utilisateur@domaine.com`), emails d'éditeurs de templates, emails de WAF | gratuit |
| F. Repli sites protégés | `curl -k` puis navigateur headless en dernier recours | une minorité de sites derrière WAF ou TLS cassé ; le rendu JS n'apporte rien ailleurs | marginal |

## À éviter

- Scraping HTML de Google (échec silencieux).
- Slug + DNS pur (faux positifs dangereux).
- Outils OSINT orientés pentest (ne mappent pas société → domaine, licences contaminantes).
- Navigateur headless en moteur principal (10 fois plus lent pour rien).

## Taux réalistes

Une part importante des PME françaises n'a pas de site : le plafond de résolution de domaine est structurel, pas lié à l'outil. Un rendement bout-en-bout de l'ordre de la moitié des lignes en domaines et d'un tiers à la moitié en emails est un ordre de grandeur ; au-delà, suspecter des faux positifs. Colonnes ajoutées : `domain`, `email`, `source`, `confidence`.

## Commande type

```bash
# option 1 : SearXNG local (docker run -d -p 8888:8080 searxng/searxng ; activer le format JSON), SEARXNG_URL=http://localhost:8888
# option 2 : pip install ddgs (repli gratuit)
node enrich.mjs --limit 50    # tester sur 50 lignes, lire les résultats, puis lancer sur la base
```

Les clés éventuelles viennent d'un fichier `.env` local de l'utilisateur, jamais de la conversation.
