---
name: client-onboarding-flow
description: Orchestre le dossier complet d'un nouveau client d'agence lead gen à partir de son formulaire d'onboarding — recherche marché, veille concurrentielle, analyse d'offre, proposition de campagne, VSL, pack Meta Ads — en enchaînant les skills correspondants et en rangeant chaque livrable dans un dossier client. À utiliser pour "onboarde {client}", "flow complet", "pipeline complet" ; pas pour produire un seul livrable isolé.
---

# Client Onboarding Flow

Orchestrateur. Il ne rédige aucun contenu marketing lui-même : il parse le formulaire, prépare le dossier client, enchaîne les skills dans le bon ordre en passant les sorties de l'un aux entrées du suivant, puis écrit un index.

## Entrées

- **Formulaire d'onboarding rempli** : fichier (md, pdf, docx, json), texte collé, ou export d'un cockpit client (Markdown ou JSON contenant les champs entreprise / offre / audience / objectif / budget).
- **Dossier client** `{CLIENT_DIR}` fourni par l'utilisateur. S'il n'est pas donné, le demander ; ne jamais choisir un chemin arbitraire sur la machine.

Les 12 champs à extraire et les champs bloquants sont dans [references/onboarding-form-schema.md](references/onboarding-form-schema.md). Si un champ bloquant manque, poser une seule question groupée et attendre la réponse avant les étapes qui en dépendent ; avancer seulement sur les étapes indépendantes. Ne jamais inventer une réponse.

## Structure du dossier produit

```
{CLIENT_DIR}/
├── 00-onboarding/onboarding-form.md      copie normalisée du formulaire (source de vérité)
├── 01-deep-search/                       3 rapports (deep-search)
├── 02-competitor-ads/                    analysis.md + data.csv (competitor-ads-research)
├── 02b-offre/                            offre-diagnostic.md + offre-reconstruite.md
├── 03-campaign-proposal/                 proposition-campagne.md (campaign-proposal)
├── 04-vsl/                               strategy.md + script-v1.md (vsl-copywriter, si funnel VSL)
├── 05-meta-ads/                          ads-multi-variantes.md (meta-ads-copywriter)
└── README.md                             index des livrables + prochaines étapes
```

Si `{CLIENT_DIR}` contient déjà des livrables, respecter la demande de mise à jour ou de reprise déjà donnée. Sinon conserver les originaux et produire une nouvelle version clairement identifiée ; demander seulement si le choix affecte le résultat attendu.

## Pipeline

| Étape | Skill | Dépend de | Sortie |
|---|---|---|---|
| 0 | (ce skill) | formulaire | `00-onboarding/onboarding-form.md` |
| 1 | `deep-search` | 0 | `01-deep-search/01-market-awareness.md`, `02-competitor-research.md`, `03-psychographic.md` |
| 2 | `competitor-ads-research` | 0 | `02-competitor-ads/analysis.md`, `data.csv` |
| 2.5 | analyse d'offre (interne, voir ci-dessous) | 1 + 2 | `02b-offre/offre-diagnostic.md`, `offre-reconstruite.md` |
| 3 | `campaign-proposal` | 1, 2, 2.5 | `03-campaign-proposal/proposition-campagne.md` |
| 4 | `vsl-copywriter` (seulement si `funnel_type = vsl`) | 1, 2, 2.5, 3 | `04-vsl/strategy.md`, `script-v1.md` |
| 5 | `meta-ads-copywriter` | 1, 2, 2.5, 3, (4) | `05-meta-ads/ads-multi-variantes.md` |

Les étapes 1 et 2 sont indépendantes et peuvent tourner en parallèle (sous-agents si l'environnement en propose, sinon séquentiellement). Les suivantes sont strictement séquentielles.

**Délégation** : pour chaque étape, invoquer le skill enfant avec un prompt explicite qui liste les inputs (chemins des fichiers amont) et le dossier de sortie. Demander au skill enfant de ne renvoyer que les chemins créés et un résumé de 3 lignes, pas le contenu.

**Synchronisation** : avant l'étape 2.5, vérifier l'existence des 4 fichiers clés (3 rapports + `analysis.md`). Fichier manquant → relancer l'étape concernée avec un prompt correctif, une fois ; sinon logger l'erreur dans `{CLIENT_DIR}/_errors.log` et demander à l'utilisateur (retry / skip / stop).

### Étape 2.5 — analyse d'offre

Aucun skill externe n'est requis. Suivre le workflow de [references/offer-analysis.md](references/offer-analysis.md) : diagnostic Value Equation de l'offre du formulaire, calibrage sur le stade de conscience et la sophistication révélés par les étapes 1 et 2, reconstruction (promesse, mécanisme nommé, stack, garantie, prix), 3 variations d'angle. Écrire honnêtement si le marché ou l'offre ne justifient pas un positionnement premium.

Si l'utilisateur dispose d'un skill d'analyse d'offre dédié et demande explicitement de l'utiliser, le router vers cette étape avec les mêmes entrées et sorties. Ce routage est facultatif, jamais supposé.

À partir de l'étape 3, les skills enfants reçoivent `02b-offre/offre-reconstruite.md` avec le statut de chaque élément. Une promesse, garantie ou condition commerciale proposée reste « à valider » jusqu'à approbation ; seuls les termes approuvés peuvent être présentés comme engagements. Le brief et les décisions validées restent les sources de référence.

## Index final

Écrire `{CLIENT_DIR}/README.md` d'après [references/client-readme-template.md](references/client-readme-template.md) : client, date, funnel, liste des livrables avec chemins, étapes sautées, champs manquants, prochaines étapes pour l'agence.

## Message de fin

5 à 10 lignes : dossier créé, livrables clés, étapes sautées (ex. VSL pour un funnel Instant Form), erreurs ou champs manquants. Ne pas recopier le contenu des livrables dans la conversation.

## Règles

- Idempotence : ne jamais écraser sans accord.
- Pas de doublon : l'orchestrateur ne refait pas le travail d'un skill enfant.
- Aucun envoi, aucune publication, aucune écriture dans une base externe. Si l'utilisateur veut importer les livrables dans son outil de gestion (cockpit, CRM), le README liste les fichiers à importer ; l'import reste une action de l'utilisateur.
- Aucune promesse de résultat commercial dans les livrables ; les objectifs de test restent des hypothèses à valider.
