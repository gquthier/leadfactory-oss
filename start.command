#!/bin/bash
# Double-clic macOS : lance le serveur local depuis le dossier du projet.
cd "$(dirname "$0")" || exit 1
echo "Démarrage de LeadFactory OSS..."
echo "Ouvrez ensuite http://127.0.0.1:4310 dans votre navigateur."
npm start
