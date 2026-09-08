# Page HTML autonome et PDF

Page `index.html` unique (CSS et JS inline), polices web au choix de l'émetteur, calculateur interactif reprenant les formules de la proposition, bouton « Télécharger PDF » qui produit un vrai fichier via une bibliothèque HTML → PDF côté navigateur (ex. html2pdf.js chargée depuis un CDN), jamais `window.print()`.

Bloc PDF `#pdf-devis` (A4) : en-tête (logo, référence, date), parties, détail du devis, conditions, pied avec lien de paiement cliquable et validité.

Piège connu : masquer `#pdf-devis` avec `display:none`, `visibility:hidden` ou un décalage hors écran produit un PDF blanc (le rendu canvas ne capture pas les éléments non rendus). Le garder dans l'arbre de rendu avec `opacity:0; z-index:-1; pointer-events:none`, puis rétablir `opacity:1` et `position:static` **dans le clone** via la callback `onclone` de html2canvas ; attendre `document.fonts.ready` avant de générer ; `scale: 2`, `useCORS: true`, fond explicite, format A4 portrait, `pagebreak: {mode: ['css','legacy']}`. Désactiver le bouton pendant la génération et afficher une erreur lisible en cas d'échec.

Tester le téléchargement dans un navigateur avant toute livraison. `vercel.json` minimal : `{"cleanUrls": true, "trailingSlash": false}`. Déploiement uniquement avec la CLI authentifiée de l'utilisateur et sur sa demande.
