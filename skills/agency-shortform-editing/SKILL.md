---
name: agency-shortform-editing
description: Monter une vidéo facecam en extraits avec captions animées, recadrages et mix discret. Utiliser pour décliner une vidéo longue ou adapter le rythme d'une référence sans reprendre ses médias.
---
# Montage facecam et captions

Entrées : source autorisée, passage ou objectif, langue, format demandé, charte et références éventuelles. Conserver le format source si aucun changement n'est demandé. Les préférences du brief priment sur les exemples de style.

1. Sonder la source : dimensions, cadence, durée, pistes audio. Préserver l'original. Lire le transcript et ses horodatages pour sélectionner une idée autonome, vérifier l'image et écouter le passage si cette capacité est disponible. Identifier la couverture réelle de la revue.
2. Définir une hypothèse créative observable : compréhension sans le contexte long, lisibilité des captions, priorité à la voix. Si des variantes sont demandées, garder le même extrait pour comparer le style.
3. Utiliser `hyperframes` puis `general-video` du pack créatif optionnel pour produire le projet, ou le moteur explicitement demandé. Charger core/keyframes/audio selon le travail. S'ils sont absents, préparer découpage, captions et recette ; signaler que le rendu reste à faire.
4. Appliquer les [recettes de captions et de cadrage](references/motion-recipes.md), adaptées au visage et aux dimensions de CETTE source. Animer le cadre sans miroir. Vérifier yeux, bouche, gestes et limites de crop pendant le mouvement. Une exportation 1080p ne restaure pas les détails perdus par le recadrage d'une source 720p.
5. Mixer voix au premier plan, musique discrète et accents utiles. Le profil sobre du pack évite les sons de réaction, applaudissements et mini-jingles par défaut. Un autre brief peut choisir une autre direction. Chaque média garde sa provenance ; aucune bibliothèque privée n'est incluse.
6. Le script [mix_under_voice.py](references/mix_under_voice.py.txt) prend des fichiers autorisés et produit un nouveau WAV : `python3 references/mix_under_voice.py.txt --voice voix.wav --music musique.wav --music-gap-db 25 --out mix.wav`. Résoudre ce chemin depuis le dossier du skill. Le suffixe .txt conserve le code Python comme référence portable lisible dans le pack natif ; Python peut exécuter ce fichier directement. Prérequis : Python, numpy et ffmpeg. Il ne coupe pas la voix ; utiliser une voix déjà montée. Ne pas repasser le WAV mixé dans une composition qui rejoue aussi les pistes originales.
7. Contrôler début/fin, mots longs/accentués, étapes intermédiaires des mouvements, synchro, durée et décodage. Mesurer le true peak après encodage ; un contrôle numérique seul n'est pas une écoute.

Livrer le MP4 réellement produit, le projet, les timings de captions, les médias autorisés ou leur inventaire, et une note de QA précisant les limites. Sans rendu, livrer le plan avec statut « à rendre ». Aucune publication n'est déclenchée par ce skill.
