---
name: sales-follow-up-sequence
description: Pilote les relances commerciales après l'envoi d'une proposition, d'un devis ou d'un lien de paiement, depuis le CRM ou le tableau de suivi de l'utilisateur — audit des leads à relancer, préparation des emails (T0, J+2 preuves, J+6 clarification) puis action humaine, envoi uniquement sur demande explicite et si tous les garde-fous passent, journalisation. À utiliser pour "relance devis", "séquence de follow-up", "qui relancer", "mettre à jour le CRM après relance" ; pas pour le cold email initial (outbound-sequence-writer).
---

# Sales Follow-Up Sequence

Le CRM (app maison, HubSpot, Pipedrive, Notion, tableau) est la source de vérité. Une information venant seulement de la conversation ne suffit jamais pour envoyer. Contrat de champs : [references/crm-contract.md](references/crm-contract.md). Règles et templates : [references/sequence-rules.md](references/sequence-rules.md).

## Modes

1. **Audit / digest** : leads éligibles, leads bloqués, prochaine action, raison exacte, email qui serait envoyé (brouillon).
2. **Préparation** : email personnalisé, objet, step, date cible, données manquantes. Aucune action externe.
3. **Envoi + mise à jour CRM** : uniquement si l'utilisateur demande explicitement l'envoi ou l'activation, et si un canal d'envoi est configuré par lui. Sinon, livrer les brouillons et les instructions de mise à jour.

Sans accès au CRM : travailler sur l'export fourni (`{CLIENT_DIR}/10-sales/pipeline.md` ou JSON), produire brouillons et décisions, et dire que l'état n'a pas été rafraîchi.

## Éligibilité (tous vrais)

Statut CRM = « séquence de follow-up activée » (ou équivalent configuré) · stage post-proposition · email valide · prénom ou repli poli · URL de proposition disponible · paiement non reçu · lead ni gagné, perdu, client, onboarding, remboursé, « ne pas contacter », désinscrit, bounce · aucune activité humaine récente demandant autre chose · step non déjà envoyé pour cette proposition · relance due (ou envoi manuel justifié). Critère ambigu → brouillon + validation.

## Workflow d'envoi (mode 3)

1. Rafraîchir le lead et ses activités depuis le CRM. 2. Vérifier les blocages. 3. Déterminer le step. 4. Construire l'email depuis les templates, sans placeholder restant. 5. Envoyer par le canal configuré. 6. Confirmer le succès du provider. 7. Mettre à jour le CRM (dernier email, step, séquence, prochaine relance, dernier contact). 8. Ajouter une activité avec clé d'idempotence. 9. Compte rendu court. Si l'étape 7 échoue : signaler « partiellement exécuté » avec la correction à faire ; ne jamais prétendre que le CRM est à jour.

## Blocages (envoi interdit)

Paiement reçu · réponse du lead après le dernier email · note ou changement humain après la relance planifiée · appel ou message prévu aujourd'hui · step déjà envoyé · lien de proposition absent · statut perdu ou « pas maintenant » · devis expiré sans nouveau devis · CRM non mis à jour possible après envoi · liens d'études de cas absents pour l'email 2. En cas de doute : ne pas envoyer, produire le brouillon et la raison.

## Format de réponse

Audit : tableau « Lead | Step | Échéance | Raison | Action » puis tableau « Bloqués ». Envoi : `Envoyé : oui/non · Lead · Step · Objet · CRM : ok/partiel/échec · Prochaine relance · Blocage`. Toujours factuel.
