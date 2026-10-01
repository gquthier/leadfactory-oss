# Bouclier natif des CLI sous Windows

État au 30/09/2026 : les tours Codex, Claude et Cursor sont refusés sur Windows par `windowsCliExecutionBlocked()`. Le prototype `scripts/prototype-windows-restricted-token.ps1` ne lève pas ce verrou : il vérifie seulement, avec deux fichiers fictifs, le second contrôle d'accès de `CreateRestrictedToken`.

## Politique et implantation

1. Créer un identifiant de restriction propre à l'installation BizOS et un lanceur natif Windows signé. Le lanceur reçoit des **handles** et des chemins validés, jamais la clé SQL, le jeton sidecar ou des secrets dans ses arguments, son environnement, ses logs ou son entrée standard. Rejeter les reparse points et les chemins qui sortent des racines permises.
2. Le processus principal garde les ACL utilisateur sur `userData`, la clé SQL chiffrée, les descripteurs sidecar et les secrets BizOS. Accorder au SID de restriction la lecture du binaire CLI, de ses dépendances et de ses seuls identifiants CLI ; accorder lecture/écriture au seul workspace explicitement choisi. Ne pas accorder ce SID aux répertoires de secrets BizOS, au profil entier ou au trousseau DPAPI. Prévoir une migration atomique des ACL et un rollback qui échoue fermé.
3. Le lanceur appelle `CreateRestrictedToken` avec `DISABLE_MAX_PRIVILEGE` et le SID de restriction, puis `CreateProcessAsUserW` avec `STARTUPINFOEXW` et une liste de handles héritables explicite. Lancer `codex.cmd`/`claude.cmd` via un `cmd.exe` contrôlé avec arguments échappés ou résoudre directement le Node et le point d'entrée JS ; ne jamais remettre le token normal à un descendant. Fermer le handle du token après le spawn.
4. Mettre le processus suspendu dans un Job Object avec `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, limites de processus/mémoire/temps raisonnables et interdiction de breakaway, puis le reprendre. Vérifier que les sous-processus du CLI restent dans le job et sont tués à l'annulation. Le Job Object est un contrôle du cycle de vie, **pas** une barrière de lecture des fichiers.
5. Évaluer AppContainer comme renforcement après le token restreint : il applique une politique par défaut plus stricte mais exige des ACL/capacités explicites pour Node, npm global, identifiants CLI, workspace et réseau. Ne l'activer qu'après la matrice Codex/Claude et tests hors ligne et réseau. `Experimental_CreateProcessInSandbox` ne doit pas être une dépendance de production avant disponibilité et support confirmés.
6. Introduire une interface `WindowsCliShield.launch()` dans les drivers, avec vérification obligatoire de l'identité du lanceur et du résultat de confinement ; conserver `secret_shield_unavailable` si le binaire, les ACL, le token ou le job échouent. Aucune dégradation vers `child_process.spawn` normal.

## Tests de sortie exigés avant déblocage

- CI `windows-latest` et `windows-11-arm` : fichiers leurres sous le profil BizOS, `APPDATA`, `LOCALAPPDATA`, `%USERPROFILE%`, fichier de clé SQL chiffré, descripteur sidecar et un espace de travail autorisé. Le CLI réel et ses enfants (`cmd.exe`, Node, PowerShell) doivent tous recevoir `ACCESS_DENIED` sur les leurres BizOS ; l'espace de travail et les seuls identifiants propres au CLI restent accessibles.
- Vérifier l'environnement et la ligne de commande de chaque enfant, les reparse points/jonctions, liens symboliques, chemins UNC, chemins courts 8.3, héritage de handles, accès au processus parent, annulation et crash. Faire échouer la CI si un seul leurre est lu ou si une exécution normale non confinée est observée.
- Canari de bout en bout avec comptes Windows jetables, Codex et Claude authentifiés uniquement par identifiants QA, réseau contrôlé, aucun secret réel. Prouver que le sidecar et l'app continuent de fonctionner et que macOS seatbelt reste vert.

## Références API

- [Microsoft : restricted tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens) : deux contrôles d'accès, SID normaux et SID de restriction.
- [Microsoft : CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken).
- [Microsoft : CreateProcessAsUserW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw).
- [Microsoft : Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- [Microsoft : AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer).
