# L'équipe

Six rôles réutilisables. Votre exécution peut créer six agents, ou un seul assistant peut les
tenir successivement. Écrire une fiche de rôle ne crée aucun agent.

| Rôle | Possède | Passe la main avec |
|---|---|---|
| Director | Brief du propriétaire, priorités, arbitrages, qualité, décision GO/KILL | Une étape cadrée et son critère d'acceptation |
| Product Research | Niches, demande observée, shortlist, concurrents, sourcing, économie unitaire | Un produit avec sa marge et son CPA plafond |
| Store Builder | Offre affichée, fiche produit, pages, parcours d'achat, paiement, conformité | Une boutique en aperçu et sa checklist prouvée |
| Creative | Angles, hooks, scripts, visuels, textes publicitaires | Un lot de créatives par angle, prêt à tester |
| Acquisition | Structure de campagne, budget, seuils de décision, plan de mesure | Un plan de lancement en attente d'autorisation |
| Operations | Rétention, service client, logistique, relevés, revue et décisions | Une revue datée et une décision par période |

Chaque rôle lit `AGENTS.md`, sa fiche dans `Agents/<Rôle>/`, puis seulement le produit et
l'étape concernés. `Processes/Handoffs.md` décrit le format de passage de relais.

Dans BizOS local, l’installation du template crée les six agents et leur équipe. Dans un autre assistant, les fichiers restent des rôles à exécuter avec ses propres outils. Vérifier les messages et tâches réellement persistés pour chaque passage de relais.
