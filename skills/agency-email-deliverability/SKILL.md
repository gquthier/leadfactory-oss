---
name: agency-email-deliverability
description: Auditer la préparation d’un expéditeur cold email et de ses séquences, les exclusions et la réception des réponses avant un pilote autorisé. Ne configure aucun compte automatiquement.
---

# Préparation de l’envoi et délivrabilité

Partir du compte d’envoi explicitement lié à cette agence ou à ce client, jamais de la première boîte connectée. Vérifier avec des lectures DNS et des en-têtes réels ou exports ; une déclaration « warmup OK » n’est pas une preuve.

1. Relever expéditeur, propriétaire, domaine, fournisseur, audience, volume attendu et historique disponible. Relier une politique d’opposition au bon périmètre ; ne pas mélanger listes de clients différents.
2. Contrôler SPF, DKIM, DMARC et leur alignement avec le From, MX/réception, TLS et DNS inverse selon l’infrastructure. Conserver valeurs non secrètes, résultat et date. Une politique DMARC ne se durcit pas sans examiner les flux légitimes.
3. Vérifier les exigences actuelles de chaque fournisseur et de chaque destination. Les [règles Gmail](https://support.google.com/mail/answer/81126) consultées le 1er octobre 2026 distinguent tous les expéditeurs et ceux qui dépassent 5 000 messages/jour vers Gmail personnel ; le seuil ne constitue pas un volume recommandé. Consulter le texte actuel plutôt qu’une table historique du skill.
4. Contrôler pertinence/provenance, suppression des oppositions, plaintes, rebonds et arrêts sur réponse. Tester les variables rendues, identité, Reply-To, liens et désinscription sur des boîtes autorisées dans le mandat d’envoi. Un lien de désinscription ne se fabrique pas dans un template.
5. Adapter le pilote aux limites du fournisseur et aux observations. Ne pas imposer une règle universelle de domaines/boîtes, un ratio Google/Microsoft, un volume journalier ou un warmup artificiel pour promettre l’inbox.
6. Définir les signaux de pause avec le propriétaire : hausse des rebonds/plaintes, identité incohérente, absence d’arrêt, quota ou statut incertain. Les seuils et le responsable doivent être écrits avant le pilote.

Livrer tableau `contrôle / preuve / date / état / correction / responsable`, lot test proposé et critères de passage. Une configuration authentifiée ne garantit ni délivrabilité ni permission d’envoyer. Le dispatch relève d’`outbound-campaign-ops`; une autorisation existante valide n’est pas redemandée.
