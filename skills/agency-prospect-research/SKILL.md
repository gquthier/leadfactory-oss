---
name: agency-prospect-research
description: Rechercher des entreprises B2B, qualifier des contacts publics et distinguer emails trouvés, vérifiés et commercialement éligibles. Utiliser avant la rédaction et l’import d’une campagne outbound.
---

# Recherche et qualification de prospects

Entrées : mandat de l’agence ou client identifié, offre, ICP, territoire, exclusions, volume et dossier de travail privé. Séparer acquisition de l’agence et prospection effectuée pour un client.

1. Trouver d’abord les entreprises et leur adéquation métier : site officiel, activité, territoire, signal daté. Le code NAF seul ne suffit pas. Chercher le bon rôle professionnel ; ne pas inventer d’adresse à partir d’un prénom.
2. Recouper clients existants, opportunités, oppositions et doublons dans le périmètre autorisé. Si le référentiel manque, `relationship_status=unchecked` ; ne pas présenter le contact comme nouveau confirmé.
3. Conserver URL précise, date et court extrait du fait/email. Vérifier que le contact appartient à l’entreprise et au bon rôle. Une adresse de prestataire technique ou DPO extraite d’un pied de page n’est pas un décideur commercial.
4. Le [collecteur Python](references/prospects.py.txt) extrait les emails visibles de pages HTTPS explicites. Il ne cherche pas les URLs lui-même et ne rend pas le JavaScript. Respecter ses refus, plafonds et robots ; ne pas contourner un site bloqué. [Commandes](references/commands.md).
5. La vérification fournisseur est optionnelle et distincte. Le script fait un dry run par défaut ; `--live` nécessite connexion personnelle et plafond autorisé. Un résultat SMTP/MX/syntaxe ou catch-all isolé ne suffit pas. Garder statut brut, contrôles, date et preuve ; aucune garantie de réception future.
6. Livrer entreprises retenues, contacts trouvés, vérifiés et prêts à rédiger séparément. Expliquer exclusions et inconnues. Transmettre à Cold Email la liste utile et les preuves, sans confondre qualification commerciale et état technique.

Sorties : `accounts.json`, `contacts.json`, `qualification.md`, sources et déduplication. Aucune liste client réelle n’est fournie par ce pack. Le collecteur et le classifieur ont des tests hors ligne ; l’accès fournisseur doit être revalidé dans chaque environnement.
