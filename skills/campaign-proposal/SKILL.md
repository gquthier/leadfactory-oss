---
name: campaign-proposal
description: Rédige la proposition de campagne Meta Ads remise au client après l'onboarding — brief stratégique et objectif de test, formulaire de qualification (Instant Form) ou script VSL, structure des campagnes (campagne, 2 ad sets, 5 à 10 créatives statiques par angle) — sous forme de document Markdown éditable, convertible en PDF. À utiliser pour "proposition de campagne", "doc post-onboarding", "structure de campagne Meta" ; pas pour écrire les pubs elles-mêmes (meta-ads-copywriter).
---

# Campaign Proposal

Document client, 3 sections fixes, rien d'autre. Par défaut, les créatives sont des **images statiques** décrites par angle, headline et texte d'accompagnement ; les scripts vidéo n'apparaissent que sur demande explicite. **Aucune section KPI, seuils de décision, projections ou règles d'optimisation** : c'est un document stratégique client, pas un reporting interne.

## Entrées

Nom du client · offre (produit, prix, promesse ; lire `{CLIENT_DIR}/02b-offre/offre-reconstruite.md` si présent) · funnel : **Instant Form** ou **VSL** (demander si flou) · audience (ICP, géo, âge, intérêts possibles) · budget quotidien envisagé · objectif de test (volume de leads visé, CPL visé, durée) · si Instant Form : critères d'un bon lead · si VSL : script existant (`{CLIENT_DIR}/04-vsl/script-v1.md`) ou demander. Rapports `01-deep-search/` et `02-competitor-ads/analysis.md` utilisés s'ils existent.

## Sections

1. **Brief stratégique et objectif de test** : un paragraphe de 4 à 7 phrases. Contexte, offre, funnel choisi, ce que la phase 1 doit valider. Les CPL et volumes sont des hypothèses de test, écrites comme telles.
2. **A. Formulaire de qualification** (Instant Form) : 4 à 6 questions numérotées (énoncé, type, options), règle de qualification explicite (qualifié / tiède / disqualifié). Banque dans [references/instant-form-questions.md](references/instant-form-questions.md). **B. Script VSL** (funnel VSL) : texte des blocs avec horodatage, sans notes de réalisation.
3. **Structure des campagnes** : nom (`[CLIENT] - [OFFRE] - [OBJECTIF] - [AAAA-MM]`), objectif Meta, budget quotidien, durée du test, 2 ad sets (intérêts ; broad), 5 à 10 créatives. Par créative : nom, angle, format (image statique 1080×1080 ou 1080×1350), headline sur l'image, primary text. Règles et justification dans [references/campaign-structure-rules.md](references/campaign-structure-rules.md).

Gabarit complet : [references/proposal-template.md](references/proposal-template.md).

## Sortie

`{CLIENT_DIR}/03-campaign-proposal/proposition-campagne.md`. Le nom de l'agence est écrit `{{AGENCY_NAME}}` si l'utilisateur ne l'a pas donné. PDF ou DOCX : convertir avec l'outil disponible (pandoc, LibreOffice, skill de génération de documents) ; la charte (logo, couleurs) est fournie par l'utilisateur. Le Markdown reste la source et doit rester modifiable.

Si l'utilisateur veut la proposition dans son outil de gestion, lui fournir en plus un JSON structuré (`brief`, `qualification`, `campaigns[]` avec `adSets[]` et `creatives[]`) ; l'import reste manuel.

## Contrôle avant livraison

Section 1 en un seul paragraphe · section 2 cohérente avec le funnel · une seule campagne sauf justification écrite, 2 ad sets, 5 à 10 créatives couvrant au moins les 5 angles (douleur, désir, preuve, contre-intuitif, urgence) · chaque créative a angle, headline, primary text · aucune section KPI · aucune tournure de remplissage (« Cette proposition vise à… », « Il est important de noter… ») · pas d'émojis ni d'icônes · promesses chiffrées uniquement quand elles sont des objectifs de test ou des preuves sourcées.

Style : phrases de 15 à 25 mots, affirmations directes (« On lance X »), 2 paragraphes max par section, listes de 7 items max.
