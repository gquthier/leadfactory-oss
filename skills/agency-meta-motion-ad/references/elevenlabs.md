# Voix ElevenLabs et timings

Python 3, bibliothèque standard. Le suffixe `.py.txt` rend le helper transportable par le chargeur natif des références ; Python l’exécute directement.

```sh
python3 references/elevenlabs_voice.py.txt --text script.txt --voice-id VOIX_AUTORISEE --model-id MODELE_CHOISI --output voice-take-01
# Après choix du texte, des droits et du budget :
python3 references/elevenlabs_voice.py.txt --text script.txt --voice-id VOIX_AUTORISEE --model-id MODELE_CHOISI --output voice-take-01 --live
```

Par défaut : dry run, aucun fichier ni réseau. En live, `ELEVENLABS_API_KEY` est configurée dans l’environnement personnel. Le helper refuse un dossier de sortie existant, borne le texte à 5 000 caractères et effectue un seul appel sans retry. Le plafond de caractères n’est pas un plafond monétaire : vérifier modèle/tarif/quotas avant l’appel.

POST `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128`, header `xi-api-key`, body `text` et `model_id`. Sorties : `voice.mp3`, `alignment.json`, `words.json`, `receipt.json` sans secret. `normalized_alignment` est préféré ; sinon `alignment`. Les timings sont ceux de l’audio, pas une estimation du storyboard. En cas d’échec réseau ambigu, vérifier l’historique fournisseur avant de relancer une génération facturable.

Les mots sont regroupés par espaces : langues sans espaces ou ponctuation particulière demandent une segmentation adaptée. Le rendu des captions doit utiliser les temps réels ; relire noms de marque et chiffres. Le helper ne clone aucune voix et ne rend aucune vidéo. Le test synthétique valide décodage/alignement/refus d’écrasement ; un test API réel et l’écoute nécessitent une connexion et un texte/une voix autorisés.
