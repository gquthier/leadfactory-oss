# Skills portables

23 skills d'agence lead gen : 21 adaptations du pack public et 2 compléments originaux, réutilisables avec Codex, Claude Code ou tout agent lisant des dossiers `SKILL.md`. Source des adaptations : `tarsluna/my-custom-skills` (MIT, commit `232612d5d5e2f97f597ac501cb007bd3be669b9e`), voir `THIRD_PARTY_NOTICES.md` et `UPSTREAM-LICENSE.txt`.

## Installation

```bash
node scripts/install-skills.mjs --target <dossier>            # tous les skills
node scripts/install-skills.mjs --target <dossier> --only creative-brief,deep-search
node scripts/install-skills.mjs --target <dossier> --dry-run
```

Zéro dépendance, Node 22+. Copie uniquement les dossiers de `skills/`. Si un dossier du même nom existe déjà dans la cible, le script s'arrête **avant** d'écrire quoi que ce soit. Aucune configuration globale n'est modifiée ; relancez votre agent après installation.

Destinations usuelles (à adapter, proposées à titre indicatif) :

| Agent | Dossier |
|---|---|
| Codex | `~/.codex/skills` (ou `$CODEX_HOME/skills`) |
| Claude Code | `~/.claude/skills` |
| Projet | `<repo>/.claude/skills` ou tout dossier de skills du projet |

Tests : `node --test test-skills/*.test.mjs`.

Deux compléments originaux sont installés de la même façon :

| Skill | Rôle | Entrées | Sorties | Prérequis |
|---|---|---|---|---|
| `agency-offer-design` | Définir une offre livrable et qualifiable | Brief agence, capacité, coûts et preuves connus | `offer.md` et version de prospection | Aucun service externe requis |
| `agency-client-success` | Reporting, retouches, renouvellement et passation | Dossier client, périmètre, versions et mesures sourcées | Point client, brouillon de message, demande de changement/passation | Outil d'envoi seulement si envoi explicitement autorisé |

`client-onboarding-flow` possède son propre diagnostic d'offre et peut router vers le skill dédié lorsque c'est utile à la mission.

## Conventions communes

- **Dossier client** `{CLIENT_DIR}` : fourni par l'utilisateur. Les exports Markdown/JSON du cockpit local (client, campagnes, tâches, livrables) sont acceptés en entrée. Les skills écrivent dans des sous-dossiers numérotés (`00-onboarding`, `01-deep-search`, `02-competitor-ads`, `02b-offre`, `03-campaign-proposal`, `04-vsl`, `05-meta-ads`, `06-landing-page`, `07-meta-setup`, `08-outbound` / `08-rework`, `09-notifications`, `10-sales`, `11-devis`).
- **Livrable par défaut** : Markdown ou JSON. Les PDF/DOCX/images/vidéos sont produits uniquement avec les outils configurés par l'utilisateur ; sinon le skill le signale.
- **Capacités externes** (recherche web, Ads Library, Meta Graph API, génération d'images, envoi d'emails, déploiement) : utilisées via les outils et secrets de l'environnement de l'utilisateur ; jamais de mot de passe ou jeton demandé dans la conversation ; indisponibilité signalée, jamais de résultat fabriqué.
- **Aucune garantie** de ventes, de ROI ou de conformité : objectifs écrits comme hypothèses, preuves uniquement sourcées.

## Les 21 skills

| Skill | Rôle | Entrées | Sorties | Prérequis externes |
|---|---|---|---|---|
| `client-onboarding-flow` | orchestre le dossier complet post-onboarding | formulaire d'onboarding ou export cockpit, `{CLIENT_DIR}` | dossier structuré + `README.md` | skills enfants installés ; analyse d'offre interne (routage optionnel vers un skill d'offre tiers) |
| `deep-search` | 3 études marché | niche, produit, géo, ICP | `01-deep-search/*.md` | outil de recherche web |
| `competitor-ads-research` | analyse des pubs Meta concurrentes | concurrents, géo, profondeur | `02-competitor-ads/{data.csv,analysis.md,brief-concurrents.md}` | outil Ads Library (MCP/API) ou accès web ; mode dégradé sinon |
| `data-scraping` | base de prospection depuis données publiques | ICP (NAF, départements, taille) | `data/*.csv`, `.xlsx`, `QA-RAPPORT.md` | API Recherche Entreprises (gratuite) ; moteur de recherche pour l'enrichissement |
| `vsl-copywriter` | script + stratégie VSL (2 modes) | rapports deep-search, offre | `04-vsl/{strategy.md,script-v1.md}` | aucun |
| `vsl-end-to-end-builder` | projet VSL complet en 5 documents | brief, assets | `04-vsl/00..04-*.md` | outil vidéo de l'utilisateur pour le rendu (hors skill) |
| `meta-ads-copywriter` | pack scripts 30/60/90 s + copies | brief, recherche, offre | `05-meta-ads/ads-multi-variantes.md` | aucun |
| `cold-traffic-landing-page` | landing statique trafic froid | site, brief, recherche, VSL/ads | `06-landing-page/` + `copy-blueprint.md` | outil de fetch ; CLI de déploiement optionnelle |
| `campaign-proposal` | proposition de campagne client | offre, funnel, audience, budget | `03-campaign-proposal/proposition-campagne.md` (+ JSON) | convertisseur PDF optionnel |
| `creative-brief` | brief créatif designer | dossier client + campagne | `05-meta-ads/creative-brief.{md,json}` | aucun |
| `creative-statics` | pipeline créatives typographiques | 4 livrables amont | `creatives/` (specs ou images) | outil de rendu image de l'utilisateur |
| `creative-statics-v2` | créatives rendues par modèle d'image | idem + profil de marque | `creatives-v2/`, matrice, prompts | moteur de génération d'images de l'utilisateur, approbation du coût |
| `meta-ads-creative-framework` | specs visuelles Figma | brief visuel | `05-meta-ads/creative-specs.md` | aucun |
| `meta-campaign-launcher` | création de campagne via Graph API, tout PAUSED | proposition validée, visuels | `07-meta-setup/recap.json` | `META_ACCESS_TOKEN` dans l'environnement, compte et Page |
| `rework-campaign` | audit et optimisation d'un compte | mandat (CPL cible, budgets) | `08-rework/rapport-{date}.md` | jeton Meta ; exécution seulement sur mandat explicite |
| `meta-lead-notifications` | notification à chaque lead Meta | page, formulaires, destination | script de polling + config planificateur + fiche | jeton Meta, jeton Slack ou webhook/SMTP |
| `cold-call-expert` | scripts de cold call B2B | offre, ICP, preuve, ton | `10-sales/cold-call-script.md` | aucun |
| `outbound-sequence-writer` | séquences cold email (JSON provider) | preset ou contexte, provider | `08-outbound/sequence-*.{json,md}` | aucun (import manuel dans l'outil d'envoi) |
| `sales-call-analyzer` | brief structuré depuis une transcription | transcription, URL site | `10-sales/brief-appel.{json,md}` | outil de fetch optionnel |
| `sales-follow-up-sequence` | relances post-proposition depuis le CRM | accès CRM ou export | audits, brouillons, mises à jour | canal d'envoi configuré pour le mode envoi |
| `devis-vercel-generator` | proposition commerciale éditable (+ page HTML/PDF) | brief d'appel, profil émetteur | `11-devis/{proposition.md,proposition.json,page/}` | CLI d'hébergement optionnelle |

## Adaptation par rapport à la source

- SKILL.md réécrits : frontmatter `name`/`description` discriminants, corps ciblé (entrées, process, livrable, contrôle qualité, handoff), français.
- Retirés : chemins `~/skills` et `/Users`, base Supabase et tables associées, récupération de jetons via `vercel env pull`, secrets historiques, exemples clients de la source, résultats commerciaux chiffrés non prouvés, instructions renvoyant vers une autre entreprise, dépendance obligatoire à un skill `demonte-ton-offre` (remplacé par un workflow interne d'analyse d'offre + routage facultatif).
- Reformulés : `creative-brief` fonctionne depuis un dossier client et une campagne (sortie Markdown + JSON, pas d'injection en base) ; `outbound-sequence-writer` et `sales-follow-up-sequence` produisent des brouillons, l'envoi reste une action explicite de l'utilisateur ; `vsl-*` distinguent script/plan de montage et vidéo rendue ; `devis-vercel-generator` livre une proposition commerciale éditable avec calculs explicites, pas un contrat ; `meta-campaign-launcher` et `rework-campaign` lisent le jeton dans l'environnement et restent en pause / en mode proposition.
- Références conservées sous forme condensée et originale (frameworks, checklists, schémas, contraintes API). Aucun asset binaire.

## Scripts et assets amont non embarqués

| Élément amont | Raison |
|---|---|
| `campaign-proposal/assets/build_proposal.py`, `deep-search/assets/build_deep_search_pdf.py`, `vsl-copywriter/assets/build_vsl_docx.py`, `meta-ads-copywriter/assets/build_meta_ads_docx.py` | générateurs PDF/DOCX brandés dépendant de reportlab/python-docx et d'une charte d'agence ; remplacés par « convertir le Markdown avec l'outil de l'utilisateur » |
| `client-onboarding-flow/assets/inject_to_database.py`, `ai_deliverables.sql`, `.env.example` | injection Supabase propre à l'infrastructure de l'agence d'origine |
| `creative-statics/scripts/*` (build_iteration, audit_heuristic, package_delivery, run_cron, launchd plists), `assets/fonts/*`, `angles_pool_template.json`, `state_template.json` | chemins codés en dur (`~/skills/projects/...`), clé fal.ai attendue en clair, exemples client dans le pool d'angles ; polices binaires non nécessaires au kit |
| `creative-statics-v2/scripts/*` (photoshoot_cli, gpt_image2_generate, engine_fal, gen_pool, build_variations, brand_lock_pass, competitor_mine, soul_id, audit_heuristic), `README.md`, `NOTICE.md`, `LICENSE` | liés à un fournisseur d'images précis (Higgsfield, fal.ai) et à des slugs de modèles instables ; le skill décrit le contrat et laisse le moteur au choix de l'utilisateur ; attribution Higgsfield relayée dans `THIRD_PARTY_NOTICES.md` |
| `creative-statics/frameworks/01-pipeline-14-steps.md`, `02-design-system.md`, `03-copywriting-framework.md` | archéologie et audit d'une session client réelle (verdicts, chemins, cas nommés) ; l'essence est reprise dans les références condensées |
| `meta-lead-notifications/scripts/poll_and_notify.py`, `slack_watch_ghl_key.py`, `templates/launchd-notif.plist.template`, `references/setup-quiz-funnel.md`, `setup-meta-instant-form.md`, `crm-webhook.md`, `email-notification.md` | script à adapter par client (labels de questions, destination) ; remplacé par un contrat de polling que l'agent implémente dans l'environnement de l'utilisateur ; le watcher de clé GoHighLevel et le funnel Railway sont spécifiques |
| `meta-campaign-launcher` (scripts référencés `pull_token.sh`, `create_*.py`) et `rework-campaign` (`fetch_insights.py`, `score_creatives.py`, `rework_orchestrator.py`) | absents du dépôt amont (référencés mais non fournis) ; `pull_token.sh` reposait sur `vercel env pull` |
| `devis-vercel-generator/templates/template.html`, `scripts/generate.mjs`, `deploy.sh`, `frameworks/01-immutable-vs-variable.md`, `04-pdf-devis-spec.md`, `templates/placeholders-map.md`, `pdf-devis-structure.md` | template figé sur la charte, les chiffres « verrouillés » et l'identité de l'agence d'origine (émetteur, tarif, comparaison marché) ; remplacé par une structure éditable et des notes HTML/PDF |
| `sales-call-analyzer/templates/brief-output-example.json`, `prompt-to-run-skill.md`, `frameworks/*` | exemple client détaillé et frameworks longs ; schéma vide et guide condensé conservés |
| `outbound-sequence-writer/presets/example-*.md` | presets d'expéditeurs d'exemple ; gabarit vide conservé |
| `cold-call-expert/research/*.md` (≈ 220 Ko) | rapports de recherche bruts ; la doctrine consolidée est reprise |
| `data-scraping/references/scraping-tools-benchmark.md` | banc d'essai daté avec chiffres non reproductibles ; conclusions reprises dans `email-enrichment-fr.md` |
| `rework-campaign/references/github-references.md` | liste de dépôts tiers non vérifiés |
| `sales-follow-up-sequence/agents/openai.yaml`, `references/source-playbooks.md` | métadonnées UI optionnelles et liste de playbooks internes |
| `install.sh` amont | installe par liens symboliques dans `~/.claude` avec clone git ; remplacé par `scripts/install-skills.mjs` (copie, refus de collision) |

## Limites

- Les skills décrivent des méthodes ; la qualité dépend des outils disponibles (recherche web, Ads Library, génération d'images, API Meta) et des données fournies.
- Aucun skill n'envoie d'email, ne publie, ne dépense de budget ni n'active de campagne sans action explicite de l'utilisateur.
- Les seuils (CPL, taux, budgets) sont des repères par défaut issus de la source, à surcharger par le contexte de chaque client.
- Les questions de conformité (RGPD, politiques publicitaires, contrats) restent à vérifier par l'utilisateur.
