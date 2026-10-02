---
name: agency-ugc-video
description: Préparer et produire une publicité UGC avec un intervenant, une voix et un avatar autorisés par le client, depuis le script jusqu'à la vidéo synchronisée. Utiliser pour une pub facecam synthétique ou une déclinaison de pitch.
---
# Publicité UGC avec voix et avatar autorisés

Entrées : offre, cible, preuves, script ou objectif, intervenant autorisé, langue, format/durée, outils et budget. Aucun visage, clone vocal, identifiant de compte ou exemple commercial personnel n'est fourni par le pack.

1. Auditer chaque affirmation du script avec sa source. Un personnage synthétique ne fournit pas de témoignage vécu. Écrire un hook, une seule idée et un CTA ; lire le texte pour vérifier la durée plutôt que garantir un nombre fixe de mots.
2. Vérifier le droit d'utiliser l'image et la voix choisies ainsi que le contexte de diffusion. Utiliser les connexions de l'utilisateur ; ne jamais rechercher des clés dans un autre projet. Les identifiants de voix et d'avatar restent dans la configuration privée, pas dans Git.
3. Choisir une chaîne réellement disponible : enregistrement fourni ou TTS ; image de l'intervenant autorisée ; lip-sync ou vidéo avatar. Vérifier la documentation actuelle du fournisseur, ses modèles/formats et les limites de durée avant l'appel. Les noms de modèles d'un ancien essai ne prouvent pas leur disponibilité.
4. Suivre le [contrat de production](references/pipeline.md). Confirmer le coût dans le mandat de génération existant. En cas d'échec, conserver l'état du job et borner les retries ; ne pas soumettre la même commande payante en boucle.
5. Vérifier identité, articulation, prononciation, mains/visage, synchro, première/dernière syllabe et contenu des captions. Pour montage, typographie et mix, utiliser `agency-shortform-editing` et le pack vidéo optionnel. Ne pas rallonger une vidéo en accélérant la voix sans vérifier l'intelligibilité.

Livrer MP4 réellement téléchargé et décodable, script, médias de travail autorisés, configuration sans secrets et QA. Une requête acceptée ou un job en cours n'est pas un fichier livré. Si l'outil manque, livrer script et prompts prêts avec statut « génération en attente ». Publier uniquement dans le périmètre demandé et avec la présentation appropriée d'un avatar synthétique.
