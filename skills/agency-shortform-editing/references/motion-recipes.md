# Recettes portables de montage

Adaptation des essais personnels du 30 septembre 2026. Valeurs de départ, pas préférences imposées à tous les clients ni paramètres récupérés d'un projet tiers.

## Captions

Blanc, ombre douce, groupes de 2–5 mots. Poppins Bold est une option, pas une police identifiée avec certitude dans toute référence. À 1280×720, essayer 44 px latéral / 48 px centré, interligne 0,90 et tracking −0,065 em. Inspecter accents et descendantes : compacter des boîtes de texte peut faire se toucher les glyphes. Fournir la police avec sa licence ou utiliser une police disponible.

À 1080×1920 : essayer 54–64 px centré ou 48–58 px latéral, marges 60–90 px à adapter aux contrôles de la plateforme. Ne pas masquer le visage. Le ratio et la taille finale dépendent du brief.

- Descente : `opacity:0,y:-70` vers `opacity:1,y:0`, 0,24–0,32 s, `power2.out`.
- Dépliage : `scaleY:.03` vers 1 sur 0,20–0,28 s ; tracking final en CSS, déplacements individuels des glyphes pour éviter les sauts de pixels.
- Accent : léger dépassement 1,035 puis retour à 1 sur 0,12 s. Réserver aux mots utiles ; ne pas animer chaque syllabe.

En HyperFrames, clip temporel extérieur et animation du nœud intérieur, timeline déterministe. Les changements ordinaires peuvent être francs.

## Cadrage

Pour une source W×H et une sortie Ow×Oh, s=max(Ow/W,Oh/H). Pour placer le visage de coordonnée fx à tx, x=tx−s×fx, borné dans [Ow−s×W,0]. Un zoom ajoute une réserve à inspecter sur les quatre bords. Mesurer à nouveau si la personne bouge.

Visage vers 67 % puis 33 % de la largeur, captions du côté opposé : exemple de bascule. Transition 0,32–0,42 s, `power3.inOut`, un mouvement par idée. Garder une variante douce pour évaluer la netteté. Aucun miroir ni bande. Inspecter coiffure et gestes, qui dépassent souvent une boîte de détection du visage.

## Son

Point de départ sobre : musique 25 dB sous le RMS de la voix normalisée, puis réglage à l'écoute. Le script mixeur garde le timing de la voix, ajoute fondus et atténuation légère. Le RMS est un repère de gain, pas une mesure de sonie perceptuelle. Clics discrets seulement sur des accents, pas un clic par mot. Contrôler le WAV puis le fichier encodé ; une crête échantillon correcte ne prouve pas un true peak correct.
