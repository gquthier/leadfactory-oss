# LeadFactory Open Agency : toute l’agence, dans un dépôt

Clarification utilisateur du **2 octobre 2026**. Le projet à ouvrir est **toute la partie réutilisable de LeadFactory** : logiciel, skills, contexte, processus et agents. Le logiciel n’est qu’une brique de l’agence. La présentation demandée est le README GitHub, selon le style du dépôt Autonomous Quiz Funnels ; aucune landing web séparée n’est nécessaire.

## Open source et template : quelle différence ?

**Open source** décrit les droits accordés sur le code et les sources : utilisation, modification et redistribution sous une licence adaptée. **Template GitHub** décrit une fonction de duplication du dépôt via « Use this template ». Un template peut contenir un projet complet, mais le bouton ne le rend ni public ni open source.

GitHub explique [les dépôts modèles](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-template-repository) et [les licences](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository). Documentation consultée le 2 octobre 2026.

## Le pack et son intégration

| Ensemble | Rôle | Sources |
|---|---|---|
| **LeadFactory Open Agency** | Tout le système réutilisable de l’agence : méthodes, contexte, agents et logiciel | [README](../README.md), `vault/`, `skills/`, `agents/`, `full-app/`, `lib/` et les ressources associées |
| **Intégration BizOS** | Une façon facultative de charger les rôles, notes et skills dans BizOS | [templates](../templates/README.md), `integrations/bizos-local/` et leur cockpit |

Ces éléments restent dans le même dépôt, avec des documentations distinctes. La présence du template BizOS ne réduit pas le projet à un template pour BizOS. Le pack complet se clone ; ses utilisateurs peuvent adapter les ressources à leurs propres outils dans le respect des licences. Le logiciel `full-app/` charge certains fichiers du parent : ne pas copier son seul sous-dossier.

L’installation native dans la version actuelle de BizOS reste à vérifier. Le cockpit léger, le coffre BizOS et l’application complète ont des contextes de données distincts ; ils ne sont pas automatiquement synchronisés.

## État de distribution

**Objectif : rendre le pack accessible à tous. État actuel : privé pendant la préparation**, conformément à la consigne de confidentialité précédente. Le code du kit est déjà sous licence MIT ; le runtime et les modules tiers gardent leurs licences. La [notice du logiciel interne](../full-app/NOTICE.md) demande de clarifier ses droits et sa licence avant une publication publique.

La branche de présentation `preview/leadfactory-open-agency-20261002` part d’un instantané des fichiers contrôlés, sans reprendre l’ancien historique du chantier, qui n’est pas certifié publiable. Une copie complète ne doit inclure ni `.local-data`, ni données métier, ni tokens, ni dépendances installées. [Couverture et limites de la revue](../full-app/CONFIDENTIALITY.md).

La présentation du pack n’active pas de compte, campagne, synchronisation ou connexion de production.
