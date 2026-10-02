# Contrat portable de production UGC

| Étape | Entrée | Preuve de sortie | Reprise |
|---|---|---|---|
| Script | Offre et affirmations sourcées | Texte, durée estimée, validation du brief | Modifier le texte avant génération |
| Voix | Intervenant autorisé, langue, paramètres privés | Audio local décodable, durée mesurée | Garder l'audio réussi |
| Portrait | Média autorisé ou génération autorisée | Image locale et droits/provenance | Réutiliser seulement si même personnage/contexte |
| Upload éventuel | Audio/image vers fournisseur choisi | Référence média du compte utilisateur | Vérifier statut avant de renvoyer |
| Vidéo | Portrait, audio, durée/ratio acceptés | Job id puis fichier final | Reprendre le suivi du job, limiter les tentatives |
| Montage | Vidéo obtenue, captions, musique autorisée | Projet et MP4 final | Versionner sans écraser les sources |

Un fournisseur peut regrouper plusieurs étapes. Ne pas inventer d'endpoint : consulter sa documentation et employer ses outils configurés. L'exécution en SaaS utilise le broker disponible sans exposer une clé plateforme ; une production autonome utilise les comptes personnels de son propriétaire.

Enregistrer par job : nom du fournisseur, modèle effectivement utilisé, version/date de doc, paramètres non secrets, horodatage, statut, coût rapporté, chemins locaux et hash des fichiers. Les URL signées, tokens et identifiants privés ne figurent pas dans un exemple public.

## Exemple fictif de script

« Vous perdez le fil entre vos briefs et vos livrables ? Rassemblez chaque campagne dans un dossier clair. Découvrez le fonctionnement. »

Cet exemple démontre une structure, sans chiffre commercial ni témoignage. Le produit réel et la destination du CTA restent à préciser.
