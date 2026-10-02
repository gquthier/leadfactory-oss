---
name: agency-product-film
description: Produire un film de lancement ou une démonstration en motion design à partir des vraies captures d'un produit. Utiliser pour un lancement SaaS, une vidéo de fonctionnalité ou une déclinaison de film produit.
---
# Film produit à partir de preuves visuelles

Entrées : produit et version, audience, message, CTA, durée/ratio, charte, accès de capture autorisé, fonctionnalités vérifiées et budget média éventuel. Distinguer film concept et démonstration fonctionnelle.

1. Construire un tableau `affirmation → source datée → capture → statut`. Ne pas transformer un écran, une réponse simulée ou une animation en preuve d'une capacité livrée. Employer des données fictives signalées dans les démonstrations ; aucune information client réelle dans le rendu.
2. Capturer la vraie UI avec un profil de démonstration isolé, selon les options réellement documentées par l'app. Ne pas réutiliser un profil connecté, déplacer une app ou tuer des processus par nom générique. Relever les PID lancés et fermer ces seuls processus. Si l'isolation ne peut pas être obtenue, utiliser les captures autorisées fournies. Ne pas recopier des flags propres à un autre produit.
3. Écrire le storyboard avec le [gabarit](references/storyboard.md) : une idée et un objet visuel lisible par scène, progression problème → action → résultat observable → CTA. Un chiffre de performance nécessite sa preuve ; une maquette se présente comme telle.
4. Avec le moteur optionnel installé, lire `hyperframes` puis `product-launch-video`, core, keyframes et audio à la demande. Rechercher dans le registre les effets utiles avant d'en écrire de nouveaux. Les captures peuvent être recadrées et animées en 3D CSS ; garder labels et action compréhensibles. Éviter les écrans réinventés lorsqu'une démonstration réelle est demandée.
5. Verrouiller la narration avant le timing final. Après un changement de voix, recalculer durée, sous-titres et espaces entre phrases ; ne pas conserver un timing devenu faux. Les voix et comptes sont ceux autorisés pour ce projet.
6. Placer musique/SFX selon les accents, garder une réserve pour les captions. Les couches audio doivent avoir un seul propriétaire de mix. Utiliser les commandes de lint, check, snapshots et rendu de la version réellement installée ; relever cette version dans le projet.
7. Revoir images stabilisées ET transitions : écran trop petit, texte coupé, chevauchement, visage flou, saut d'identité, noir involontaire, fin tronquée. Décoder le MP4 final et contrôler synchro/son.

Livrer vidéo finale, projet éditable, storyboard, inventaire des médias et tableau de preuves. Signaler précisément les scènes simulées, les limites de capture et les contrôles non réalisés. Le pack fournit la méthode et les scripts tiers optionnels ; aucun rendu ni API payante ne s'exécute à l'installation.
