# Validation du starter privé — 1er octobre 2026

Complément : la [revue élargie](CONFIDENTIALITY.md) a retiré des exemples commerciaux et noms personnels non identifiés dans le contrôle initial. Les chiffres ci-dessous décrivent la première recette ; les nouvelles preuves sont dans cette revue.

Source lue : logiciel privé `gquthier/leadfactory-app`, commit `e909784b7a28982825b3a1b4d7ee0ff8b27e9bf1` du 20 juillet 2026. Statut : adaptation locale vérifiée, aucune connexion à la base ou aux comptes d’origine. Les écrans et adaptateurs historiques sont repris ; les données et secrets ne le sont pas.

- `npm test` dans full-app : 23 tests réussis, dont l’orchestration des quatre rôles avec fournisseur simulé, arrêt, reprise sans rejeu, isolation des clients/sources/briefs, proposition compatible avec l’éditeur natif, persistance, absence de secrets dans les réponses, accès local et origine.
- `npm test` du pack : 141 tests réussis. Le runtime BizOS n’a pas été modifié par ce lot ; ses validations antérieures ne certifient pas l’installation du nouveau dashboard dans l’app desktop.
- `npm run build` : compilation Next.js 15.5.27 et validation TypeScript réussies. Environnement de cette recette : Node.js 26.8.1, macOS ; Node.js 22+ reste le prérequis annoncé, sans matrice de versions rejouée ici.
- SQL : 50 tables et 597 colonnes, RLS sur chaque table, bootstrap vide et séparation client validés dans PostgreSQL en mémoire. Voir `database/validation-report.json`. Aucun serveur de base existant n’a été interrogé.
- Navigateur : vingt vues de navigation admin ouvertes, sans erreur JavaScript ni requête externe lors de la recette. Parcours réel du formulaire neuf étapes, enregistrement du client/brief/campagne, source rattachée au client, message explicite sans IA connectée ; recrutement d’un membre humain sans email ni partage de mot de passe. Gardes Host/origine et téléchargement du SQL testés.
- Confidentialité : scan ciblé de la copie source, contacts/UUID/URLs/jetons, puis revue des parcours d’accès et emails. Aucun secret ou contact réel d’origine identifié. Les environnements, historiques, données métier, uploads et archives brutes d’origine sont exclus de la distribution. Ce contrôle est borné aux sources distribuées et aux motifs revus, sans audit de production implicite.

Les missions automatiques ont été testées avec une IA simulée et des dossiers fictifs. Aucun vrai appel CLI, Slack, Meta, ElevenLabs, campagne, email, voix ou rendu vidéo n’a été lancé dans ce lot. Les adaptateurs historiques externes sont présents mais désactivés ; les actions locales non prises en charge renvoient une erreur explicite. Le mode distant Supabase, l’authentification multi-utilisateur et un déploiement public demandent leur propre recette. Les URL ajoutées aux sources sont des références ; leur contenu n’est pas téléchargé automatiquement.

Le dossier `full-app` est livré comme source autonome dans le pack et l’export privé. Il n’est pas embarqué ou installé dans BizOS par ce travail. Le cockpit racine reste distinct. Aucun changement de visibilité GitHub ni push n’est effectué.
