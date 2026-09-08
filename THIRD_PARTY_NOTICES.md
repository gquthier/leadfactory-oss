# Third-party notices

## Skills (`skills/`)

Parmi les 23 skills du dossier `skills/`, 21 sont des adaptations du dépôt public
**tarsluna/my-custom-skills** — https://github.com/tarsluna/my-custom-skills —
commit `232612d5d5e2f97f597ac501cb007bd3be669b9e`, licence MIT (copyright (c) 2026 tarsluna).
Le texte intégral de la licence amont est reproduit dans `UPSTREAM-LICENSE.txt`.

`agency-offer-design` et `agency-client-success` sont des compléments originaux du kit,
distribués sous sa licence MIT.

Les adaptations (réécriture des SKILL.md, retrait des chemins, secrets, données clients et
dépendances d'infrastructure, références condensées) sont documentées dans `docs/SKILLS.md`.

Attributions relayées par le dépôt amont :

- `competitor-ads-research` : structure inspirée du skill `competitive-ads-extractor`
  (ComposioHQ/awesome-claude-skills, MIT) et d'un cas d'usage de Sumant Subrahmanya.
- `creative-statics-v2` : la version amont portait des scripts et modes issus de
  `higgsfield-ai/skills` (MIT, copyright (c) 2026 Higgsfield AI). Ces scripts ne sont pas
  embarqués ici ; seule la méthode (matrice, art-direction, revue) est reprise.
- `cold-call-expert` : synthèse de sources publiques citées dans la référence du skill
  (30MPC, Josh Braun, Chris Voss, Sandler, SPIN, Challenger, Gong Labs), sans reproduction de contenu.

Les polices Instrument Serif et Space Grotesk (SIL Open Font License) présentes dans le dépôt amont
ne sont pas embarquées.

## Notice V2 amont conservée

# NOTICE — Third-party attributions

This skill ports logic and patterns from third-party open-source projects. Their
licenses are preserved below as required.

---

## higgsfield-ai/skills (MIT)

`scripts/photoshoot_cli.py`, `scripts/soul_id.py`, and `frameworks/04-official-photoshoot-modes.md`
port the command interface, mode definitions, and Soul ID workflow from
**https://github.com/higgsfield-ai/skills** (skills `higgsfield-product-photoshoot`
and `higgsfield-soul-id`).

```
MIT License

Copyright (c) 2026 Higgsfield AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Also referenced (official SDK, not vendored): `higgsfield-ai/higgsfield-client`
(Python SDK) and `higgsfield-ai/cli`.
