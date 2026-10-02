# Moteur créatif optionnel : 12 skills HyperFrames

Snapshot local des installations des **28–30 septembre 2026**, empaqueté le **1er octobre**. Source : [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes), Apache-2.0. [Provenance et hashes des sources](PROVENANCE.json) · [Licence](LICENSE.txt).

Les méthodes d'agence fonctionnent sans installer ce complément. Il ajoute les instructions, références et scripts de travail HyperFrames ; **le CLI de rendu, ses dépendances et les services externes ne sont pas embarqués**.

Depuis la racine du pack, vers un nouveau dossier de skills de votre projet :

```sh
node scripts/install-skills.mjs --pack creative --target ./my-agency/.claude/skills --dry-run
node scripts/install-skills.mjs --pack creative --target ./my-agency/.claude/skills
```

L'installation copie les fichiers localement, conserve les licences et refuse les collisions. Elle n'exécute aucun script tiers. Si HyperFrames est déjà installé, utilisez cette installation ou choisissez un nouveau dossier ; ne remplacez pas automatiquement vos versions.

| Module | Usage |
|---|---|
| hyperframes | Point d'entrée et routage du travail vidéo |
| general-video | Montage général et compositions sur mesure |
| product-launch-video | Films de lancement et démonstrations |
| hyperframes-core | Contrat de composition et timing |
| hyperframes-animation | Mouvement, scènes et transitions |
| hyperframes-keyframes | Recadrage, zoom et mouvements seekables |
| hyperframes-audio | Mix des pistes placées |
| hyperframes-creative | Direction artistique et narration |
| hyperframes-registry | Recherche de composants réutilisables |
| hyperframes-cli | Prévisualisation, contrôle et rendu |
| hyperframes-studio | Travail dans Studio |
| media-use | Acquisition et préparation des médias |

Pour exécuter un rendu, suivre le [démarrage officiel](https://github.com/heygen-com/hyperframes#quick-start), vérifier la version du CLI réellement utilisée et la figer dans le projet. Les workflows amont peuvent proposer d'autres skills, des téléchargements, une mise à jour ou des services payants : ils restent soumis au périmètre et aux connexions du projet. Le snapshot ne garantit pas la compatibilité avec toute version future du CLI.

## Différences avec les fichiers installés

- Ajout de LICENSE.txt et NOTICE.md dans chaque skill pour préserver l'attribution lors d'une installation isolée.
- 19 MP3 issus de Pixabay exclus de la distribution ; catalogue SFX vide et notice adaptée. Apporter des sons autorisés ou les générer. Aucun son de cette bibliothèque n'est annoncé comme inclus.
- `.gitignore` technique de media-use omis ; les autres scripts, références et exemples sont conservés.
- Six fichiers de polices conservés avec leurs trois licences SIL OFL adjacentes. Les licences de polices restent distinctes d'Apache-2.0.

PROVENANCE.json enregistre les empreintes des fichiers sources copiés ; les modifications ci-dessus sont déclarées. Le SHA GitHub indiqué vérifie le texte de licence consulté, pas l'identité de tout le snapshot avec ce commit.
