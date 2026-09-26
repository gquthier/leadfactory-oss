---
name: outbound-campaign-ops
description: Préparer et opérer une campagne outbound client depuis une liste qualifiée et une séquence, avec contrôle des exclusions, mandat de campagne, lots bornés, preuves fournisseur et reprise sans doublon.
---

# Opérations d'une campagne outbound

Ce skill orchestre une liste et une séquence existantes. Pour les produire, utiliser les méthodes de recherche et de rédaction disponibles ; ne pas refaire leur travail. Travailler sur un `clientId` et un `campaignId` explicites. Si le propriétaire veut préparer seulement, livrer les fichiers et les tâches d'import.

## Dossier de campagne

Réunir l'offre validée, la liste sourcée, la séquence versionnée, l'identifiant du compte d'envoi et les limites décidées : destinataires, canaux, dates, cadence, taille du lot, budget s'il y en a un, et critères d'arrêt. Lire les exclusions du client et du compte autorisé. Ne pas mélanger les contacts ou les preuves de deux clients.

Vérifier la préparation du fournisseur à partir de son statut ou de preuves fournies : expéditeur vérifié, configuration de domaine, canal opérationnel, mécanisme de désinscription/exclusions, créneau et limites. Ces contrôles ne garantissent pas la délivrabilité. Un identifiant de compte ou un lien de configuration suffit dans le dossier ; aucune clé ou valeur de connexion n'y est copiée.

Dans BizOS cloud/SaaS, appeler uniquement les outils du broker autorisés pour cette campagne. Ne jamais chercher une clé de plateforme dans un fichier, l'environnement, un déploiement ou une base. Dans le mode autonome BYOK, le propriétaire configure sa propre connexion dans l'outil d'envoi ; ce contexte est distinct du SaaS. Un outil absent signifie import/opération en attente, pas permission d'accéder à d'autres secrets.

## Préparer puis exécuter le lot autorisé

1. Vérifier source/date, champs requis et pertinence de chaque ligne. Dédupliquer dans la liste et contre l'historique autorisé avec une clé stable compte + campagne + adresse normalisée. Mettre en quarantaine contacts incertains, réponses déjà reçues, oppositions, rebonds permanents et exclusions. Ne pas fabriquer d'adresse manquante.
2. Préparer `08-outbound/campaign-plan.md`, `recipients.csv` et l'import JSON/CSV du fournisseur demandé. Garder la preuve de sélection, la version de la séquence et un identifiant stable de lot dans `batch-ledger.json`. Un export n'est pas un envoi.
3. Pour un envoi demandé et déjà autorisé, vérifier que ce lot entre dans le mandat. Si le mandat manque, rendre le lot concret et reviewable avant la demande d'autorisation. Ne pas redemander un accord identique déjà valide.
4. Envoyer seulement avec l'outil réellement disponible. Enregistrer l'identifiant fournisseur, l'horodatage et l'état observé par destinataire. Distinguer préparé, accepté par fournisseur, livré, répondu, en échec et inconnu. Un HTTP réussi ou un nombre d'emails générés ne prouve pas une livraison.
5. Si la réponse réseau est ambiguë, marquer le résultat inconnu et consulter l'état ou les receipts existants. Ne pas renvoyer le même lot avec une nouvelle identité pour « réparer » une réponse perdue. Arrêter tout nouveau dispatch sur STOP, opposition, plafond atteint, erreur répétée ou doute sur le bon compte ; rapprocher ensuite les actions déjà acceptées.

Le cockpit enregistre la campagne, ses tâches et ses livrables via `agency_campaigns`, `agency_tasks`, `agency_deliverables`. Il ne fournit pas lui-même de moteur cold email ni d'automatisation de relance. Enregistrer le ledger dans le dossier privé autorisé, avec seulement un résumé et sa référence dans le cockpit. Lire `Processes/Outbound operations.md` pour le relais opérationnel ; les réponses vont à `outbound-reply-qualification` si ce skill est disponible.
