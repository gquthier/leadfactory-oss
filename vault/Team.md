# Team — huit rôles d’agence

Huit templates source avec prompts système et skills affectés. Dans le parcours natif actuel du code fourni, seul CEO démarre ; les sept spécialistes sont recrutés lorsqu’une mission autorisée en a besoin. Un fichier de rôle n’est ni un agent actif ni un message envoyé. Les installations existantes ne sont pas migrées par ce pack.

| Rôle | Propriétaire de | Entrée → sortie | Relais |
|---|---|---|---|
| [[Agents/CEO/CEO.md|CEO]] | Offre, capacité, arbitrages, qualité et portefeuille | Brief propriétaire → priorités et missions vérifiées | Les sept spécialistes |
| [[Agents/Acquisition/Acquisition.md|Acquisition]] | Clients de l’agence | ICP/offre → opportunité qualifiée et contrat confirmé | Cold Email / Media Buyer pour les canaux, puis Onboarding |
| [[Agents/Onboarding/Onboarding.md|Onboarding]] | Dossier, engagements et accès client | Vente confirmée → brief et critères de réception | Delivery |
| [[Agents/Delivery/Delivery.md|Delivery]] | Livraison, délais, QA, retours et relation client | Brief accepté → livrables/recette/reporting | Creative Strategist, Media Buyer, Cold Email ; arbitrages CEO |
| [[Agents/Media Buyer/Media Buyer.md|Media Buyer]] | Configuration, mesure et optimisation publicitaire | Mandat/brief/assets → état de campagne relu | Delivery et Creative Strategist |
| [[Agents/Cold Email/Cold Email.md|Cold Email]] | Liste, séquence, dispatch autorisé et réponses | Segment/mandat → événements et opportunités qualifiés | Acquisition pour l’agence, Delivery pour une prestation client |
| [[Agents/Creative Strategist/Creative Strategist.md|Creative Strategist]] | Recherche, angles, copy, design, vidéo et apprentissage | Brief/preuves → paquet créatif vérifié | Delivery et Media Buyer |

| [[Agents/Communication client/Communication client.md|Communication client]] | Proposition et décisions client | Travaux internes → document viable et retour tracé | Delivery, Media Buyer et Creative Strategist |

Les responsabilités de l’ancien Account Manager sont reprises par Delivery ; Strategist et Creative sont réunis dans Creative Strategist ; Agency Director devient CEO. L’historique source reste archivé hors du vault vivant.

Chaque rôle charge ses skills à la demande. Creative Strategist accède à toute la bibliothèque créative et aux 12 modules HyperFrames optionnels si installés. Les autres agents peuvent demander un livrable à ce rôle plutôt que charger tout le corpus.

Outils, comptes, identités et permissions restent ceux de l’environnement réel. Le catalogue ne les crée pas. Suivre `Processes/Handoffs.md` pour l’acceptation et la sortie de chaque mission.
