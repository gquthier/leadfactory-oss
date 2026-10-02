# Skills locaux : sélection et niveau de preuve

Complément ultérieur du 1er octobre : le [parcours onboarding](DEMO-ONBOARDING.md) ajoute Communication client et le skill `agency-meta-motion-ad` (Opus 5.5 recommandé, ElevenLabs). Le pack courant a **8 rôles, 39 skills + 12 modules optionnels**. L’inventaire et la sélection ci-dessous conservent leur périmètre de lecture initial.

Lecture : **1er octobre 2026**. Statut : **package privé, préparé localement**. Sources locales observées ce jour, historiques datés du 21–26 septembre pour les validations citées. Les dates de modification d’un fichier ne prouvent pas une exécution.

## Couverture réelle

L’[inventaire de métadonnées](SKILL-INVENTORY.json) recense **11 333 chemins, 475 contenus distincts de SKILL.md, 403 noms distincts à la collecte, anonymisés dans la distribution** dans les installations Codex, Claude, Agents, le second cerveau documentaire et les dépôts de développement. Les copies/worktrees expliquent une grande partie du volume. Les SKILL.md ont été lus automatiquement pour extraire noms et empreintes ; cela ne signifie pas une revue métier de 403 skills. Quelques liens cassés/inaccessibles et une source iCloud ont été exclus. Ce n’est pas un inventaire exhaustif du disque.

Une revue métier ciblée a porté sur les sources ci-dessous. Les chemins personnels détaillés et empreintes sources restent dans le dossier de travail privé du hub, pas dans le kit réutilisable. Les transcriptions, médias clients et contenus cloud privés ne sont pas redistribués.

## Retenus et adaptés

| Sources locales examinées | Ajout / adaptation | Preuve et limite |
|---|---|---|
| Démonte ton offre ; synthèse associée | `agency-offer-lab` | Méthode relue et réécrite ; pas une preuve de revenu. Attributions historiques corrigées. |
| Webinar launch selling ; synthèse et README | `agency-one-to-many-sales` | Pitch, preuves, objections, mesure ; pas de chiffres de vente historiques repris comme résultats de l’agence. |
| Workflow local de prospection, cold email et outreach ops ; deux scripts et tests | `agency-prospect-research`, références d’`outbound-campaign-ops` | Tests comportementaux hors réseau rejoués sur les copies adaptées. Collecte publique historique : 6 pages et 8 adresses le 21 septembre ; vérification payante et envoi non testés ici. |
| Email infrastructure, email finding, cold-email-sending, direct-response-copy | `agency-email-deliverability` et chaîne outbound existante | Réécriture : pas de quotas universels ni de MX assimilé à une adresse vérifiée. Le dossier cold-email-sending n’a pas les scripts qu’il annonce : non repris. |
| Ecom Facebook Ads / Meta Ads manage / audit | `agency-media-buying`, `meta-campaign-launcher` révisé | Revue des parties configuration/outils, pas exécution de campagne. Les outils d’analyse ou pause/budget ne prouvent pas la création. Schéma Meta à vérifier au moment du run. |
| CRO e-commerce ; quiz-funnel-expert (lecture partielle) | `agency-conversion-optimization`, `agency-quiz-funnel` | Méthodes génériques originales ; benchmarks et chiffres de paywall non importés. |
| Brand identity | `agency-brand-direction` | Méthode portée en fichiers ; outils serveur supposés par la source non inventés. |
| Studio créatif local | `agency-creative-testing` | Manifest par concept, preuve des assets, QA et apprentissage. Aucun asset client copié ni rentabilité prétendue. |
| Captions/montage récents, product film, UGC | Trois skills créatifs déjà intégrés | Mixer portable ; identités/voix/visages à fournir avec autorisation. Pas de nouvelle vidéo rendue pour cette livraison. |
| Suite HyperFrames installée localement | 12 modules optionnels déjà intégrés | Snapshot documenté, licences conservées ; lecture ciblée, pas audit intégral des 400 fichiers ni validation de tous les moteurs de rendu. |

**Résultat : 38 skills Agency + 12 modules créatifs optionnels.** Neuf nouveaux skills métier s’ajoutent au précédent package de 29. Les sept [agents](../agents/README.md) ont 91 associations de skills ; le créatif dispose de toute la chaîne créative, chargée à la demande.

## Réserve : candidats potentiels, pas ajoutés tels quels

- `creative-ideation`, `cold-email-sequence`, SEO content et SEO audit : noms/sources repérés dans d’autres packages ; revue complète, dépendances et droits nécessaires avant portage. Les packages du moteur cloud restent hors distribution.
- Montage horizontal historique : SKILL.md lu ; pipeline à rapprocher des captions récentes. Vertical historique repéré, non relu intégralement ; ne pas présenter ces variantes comme deux workflows supplémentaires testés.
- Prospection / infrastructure email : configuration DNS, vérification fournisseur, réputation et boucle de désinscription doivent être vérifiées avec les comptes du futur utilisateur. Le ledger local n’applique pas une exclusion chez un fournisseur.
- Skills trop liés à un client ou outils serveur absents : conserver la méthode réutilisable, ne pas embarquer des données, identifiants ou instructions inopérantes.

## Référence orale et vérification externe

« one and done millionnaire d’Ormoye » reste une transcription incertaine. Les correspondances trouvées sont **Alex Hormozi, $100M Offers / $100M Leads**, et **Jason Fladlien, One to Many**. Cette association reste à confirmer par l’utilisateur ; aucun skill portant exactement ce titre n’a été retrouvé.

Vérifications primaires du 1er octobre : [ouvrage Offers](https://shop.acquisition.com/products/100m-offers-hardcover), [programme Offers](https://www.acquisition.com/training/offers), [programme Leads](https://www.acquisition.com/training/leads), [Jason Fladlien](https://jasonfladlien.com/), [consignes expéditeurs Gmail](https://support.google.com/mail/answer/81126). Les pages de programme ont été consultées, pas toutes leurs vidéos. La page Meta a répondu 429 : aucun schéma API courant certifié.

## Sens de « fonctionne »

Les tests du package établissent les liens prompts/skills, la reproductibilité du manifeste et les comportements locaux couverts. Les tests Python établissent extraction/classification, préservation des sorties, idempotence des événements, arrêt et exclusions sur données fictives. Ils ne prouvent ni l’efficacité commerciale des prompts ni une campagne, un envoi réel, un rendu vidéo ou une intégration à la version actuellement installée de BizOS Simple. La recette datée accompagne la livraison ; aucun agent n’est activé par ce travail.
