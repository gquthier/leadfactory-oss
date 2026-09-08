# Template d'agence pour BizOS

Lecture du code et des contrats : **8 septembre 2026**. Statut : pack documentaire livré ; intégration et parcours dans l'application à développer et vérifier.

Le fichier `templates/lead-gen-agency.company-template.json` décrit dossiers, notes, rôles et équipe au format `CompanyTemplate` observé dans le harnais local. Le dossier `vault/` reste utilisable comme second cerveau Markdown avec un assistant choisi par l'utilisateur. Aucune routine n'est activée par ce pack.

## Intégration locale attendue

1. Ajouter le pack au catalogue de templates du harnais local avec son identifiant et sa version.
2. Proposer « Agence de génération de leads » dans l'onboarding, avant l'application du template par défaut.
3. Afficher les dossiers et agents à créer ; conserver l'identité de l'espace local et les données existantes.
4. Appliquer via le mécanisme du harnais qui crée réellement notes, agents et threads, avec suivi idempotent de la version. Ne pas remplacer un second cerveau existant.
5. Présenter l'équipe, le premier message et la configuration des outils manquants.
6. Prouver création, échange réel, livrable, arrêt et reprise sans doublons dans l'app installée.

Le JSON est une donnée de template ; ce dépôt ne fournit pas d'importeur BizOS testé. Les noms d'agents ne leur confèrent aucun outil, compte ou accès automatiquement.

## Cloud et local

| Champ | Local OSS | Cloud BizOS |
|---|---|---|
| product | local-bizos-oss | signal-bizos-cloud |
| execution | Harnais local et fournisseur choisi par l'utilisateur | Harnais cloud BizOS |
| data-owner | Espace local de l'utilisateur | Entreprise cloud autorisée |
| capabilities | Dépendent des outils réellement configurés | Dépendent des outils et permissions serveur |
| out-of-scope | Aucun accès ou transfert implicite cloud | Aucun export du moteur privé |
| proof | Agents, threads et livrables locaux observables | Création et exécution réelles côté backend cloud |

La même matière métier générique peut inspirer une intégration cloud, mais elle exige un adaptateur propre au backend cloud. Aucun transfert automatique d'identité, de conversations, de credentials ou de données entre modes. Un fournisseur distant personnel reste un service distant.

## Critères de réception

Un template est réellement intégré lorsque sa sélection crée une équipe exécutable persistante dans le bon mode, que les agents produisent et partagent un livrable autorisé, et que la reprise ne duplique ni dossiers ni équipe. Une galerie ou un manifeste seul ne valide pas ce parcours.
