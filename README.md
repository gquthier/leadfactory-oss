<div align="center">

![SALES · LEAD GEN AGENCY](https://img.shields.io/badge/SALES-LEAD_GEN_AGENCY-12A594?style=for-the-badge)

# LeadFactory Open Source

### Le logiciel et les 23 skills pour faire tourner une agence de génération de leads.

```
 _                    _ _____          _
| |    ___  __ _  __| |  ___|_ _  ___| |_ ___  _ __ _   _
| |   / _ \/ _` |/ _` | |_ / _` |/ __| __/ _ \| '__| | | |
| |__|  __/ (_| | (_| |  _| (_| | (__| || (_) | |  | |_| |
|_____\___|\__,_|\__,_|_|  \__,_|\___|\__\___/|_|   \__, |
                                                     |___/
```

La version open source de LeadFactory.<br>
Un cockpit local pour gérer clients, onboarding, campagnes et livrables,<br>
et les méthodes d'agence sous forme de skills pour Claude Code, Codex ou tout agent.

[![BizOS — build autonomous companies](https://img.shields.io/badge/BizOS-build_autonomous_companies-12A594?style=for-the-badge)](https://bizos.cc)

[![X](https://img.shields.io/badge/@gauthierthiry-000000?style=flat&logo=x&logoColor=white)](https://x.com/gauthierthiry)
[![YouTube](https://img.shields.io/badge/@gquthier-FF0000?style=flat&logo=youtube&logoColor=white)](https://youtube.com/@gquthier)

<sub>Cockpit Node.js sans dépendance · 23 skills d'agence · onboarding client · export Markdown/JSON · MIT</sub>

</div>

---

## Quick start

Prérequis : [Node.js 22+](https://nodejs.org/).

```sh
git clone https://github.com/gquthier/leadfactory-oss.git
cd leadfactory-oss
npm start
```

Ouvrez **http://127.0.0.1:4310**. Aucune dépendance à installer, aucun compte à créer. Sur macOS, double-cliquez `start.command`.

Le cockpit démarre vide (une démo fictive est disponible). Vos données restent dans `data/`, exclu de Git.

## Ce qui est inclus

| Brique | Rôle |
|---|---|
| **Cockpit** | Clients, campagnes, tâches, questionnaire d'onboarding, livrables texte, export/import JSON et dossier client Markdown |
| **23 skills** | Offre, prospection, cold email et cold call, Meta Ads, créatives, VSL, landing pages, propositions, onboarding, suivi client — [catalogue](docs/SKILLS.md) |
| **Playbook** | Le parcours de l'agence, de l'offre au reporting client — [guide](docs/AGENCY-PLAYBOOK.md) |

Les modèles préremplis du cockpit fonctionnent sans IA. **Rédiger avec mon IA** utilise, si vous le souhaitez, votre propre clé OpenRouter.

## Installer les skills

```sh
# Claude Code
node scripts/install-skills.mjs --target ~/.claude/skills
# Codex
node scripts/install-skills.mjs --target ~/.codex/skills
```

L'installateur refuse d'écraser un skill existant. Options : `--only a,b`, `--dry-run`.

## Votre premier client

Suivez [Start Here](docs/START-HERE.md) : renseignez l'agence, créez un client et complétez son onboarding. La soumission prépare une campagne brouillon, une checklist et un brief. Exportez ensuite le dossier Markdown du client et donnez-le à votre assistant avec le skill adapté.

```
 Onboarding ──▶ Brief ──▶ Campagne brouillon ──▶ Skill (assistant) ──▶ Livrable relu
     ▲                                                                     │
     └──────────────────────── cockpit (data/) ◀──────────────────────────┘
```

Les comptes de cold email, de publicité et de génération de médias sont les vôtres. Aucun envoi, aucune dépense ni routine n'est déclenché automatiquement.

## Développement

```sh
npm test
```

Voir [CONTRIBUTING](CONTRIBUTING.md). Utilisez des fixtures fictives et gardez données clients et connexions hors des contributions.

## Licence

**MIT**. 21 des skills sont adaptés de [tarsluna/my-custom-skills](https://github.com/tarsluna/my-custom-skills) (MIT) — détails dans [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md). Le logiciel a été réécrit ; aucune donnée client de LeadFactory n'est redistribuée.

---

<div align="center">

### Tu construis quelque chose qui tourne tout seul ?

[![BizOS — build autonomous companies](https://img.shields.io/badge/BizOS-bizos.cc-12A594?style=for-the-badge)](https://bizos.cc)

[![X](https://img.shields.io/badge/@gauthierthiry-000000?style=flat&logo=x&logoColor=white)](https://x.com/gauthierthiry)
[![YouTube](https://img.shields.io/badge/@gquthier-FF0000?style=flat&logo=youtube&logoColor=white)](https://youtube.com/@gquthier)

</div>
