# Third-party notices

## Périmètres de licence

Le cockpit autonome, les documents et les éléments originaux du kit d’agence sont sous **MIT**, voir [LICENSE](LICENSE). Les sources du runtime BizOS local embarquées dans [`integrations/bizos-local/runtime/`](integrations/bizos-local/runtime/) sont sous **AGPL-3.0-only**, voir leur [LICENSE](integrations/bizos-local/runtime/LICENSE). La licence MIT du kit ne remplace pas celle de ce sous-dossier.

Le runtime conserve ses attributions amont, notamment les éléments Apache-2.0 documentés dans son `NOTICE` et son dossier `LICENSES/`. Son build copie le cockpit, les skills et les notes du présent kit comme ressources ; ces ressources conservent leurs licences et notices d’origine. Les fichiers du runtime sont des sources de l’intégration locale, pas un export du moteur cloud privé.


## Skills (`skills/`)

Parmi les 39 skills du dossier `skills/`, 21 sont des adaptations du dépôt public
**tarsluna/my-custom-skills** — https://github.com/tarsluna/my-custom-skills —
commit `232612d5d5e2f97f597ac501cb007bd3be669b9e`, licence MIT (copyright (c) 2026 tarsluna).
Le texte intégral de la licence amont est reproduit dans `UPSTREAM-LICENSE.txt`.

`agency-offer-design`, `agency-client-success`, `agency-portfolio-ops`,
`outbound-campaign-ops` et `outbound-reply-qualification` sont des compléments originaux du kit,
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

## E-commerce template

The second business template and its 24 skills retain their own [source and license notices](ecommerce/THIRD_PARTY_NOTICES.md). Training transcripts and private business context are not part of this distribution.

## Creative extension — 1 October 2026

`agency-shortform-editing`, `agency-product-film` and `agency-ugc-video` adapt the repository maintainer’s own editing/product-film/UGC workflows into reusable MIT methods. Personal identities, provider IDs, private projects and historical API scripts are excluded. The portable audio mixer is adapted with output/report preservation checks.

The 12 optional HyperFrames skills in `extras/creative-engine/skills/` retain **Apache-2.0**, not the kit MIT license. Source: https://github.com/heygen-com/hyperframes. Each directory carries its license and notice; [snapshot provenance](extras/creative-engine/PROVENANCE.json) records source hashes and declared modifications. Font binaries retain adjacent SIL OFL notices. The upstream Pixabay MP3 collection is omitted and its catalog emptied. No right to personal voices, faces or customer media is conveyed.

## Agency team extension — 1 October 2026

Nine original portable methods are added: offer lab, one-to-many sales, prospect research, email deliverability, media buying, conversion optimization, brand direction, quiz funnel and creative testing. Together with the previous eight original methods, these make 18 original skills and 21 upstream adaptations.

The offer method references Alex Hormozi's public $100M Offers / $100M Leads concepts; one-to-many sales references Jason Fladlien. These are independently written operating instructions, not reproductions of books, training transcripts or endorsements. Local user workflows informed the adaptations; client material, personal context and cloud runtime packages are excluded.

The prospect-research and outbound-ledger Python utilities are adapted from the repository maintainer's local outreach workflows (21 September 2026), with synthetic tests, neutral user agent and output preservation. No original prospect list, message or client asset is included. These utilities do not provide an email-sending connector.

## Portal and motion extension — 1 October 2026

The client portal, bounded drafting workflow, proposal scaffold and `agency-meta-motion-ad` are original MIT additions. The motion skill references the ElevenLabs API and the user-requested Claude Opus 5.5 model; neither provider's service, voice assets nor model weights are bundled. The campaign-proposal adaptation retains upstream MIT attribution while replacing fixed campaign structures with contextual viability criteria.

## Adaptation privée du logiciel LeadFactory

Le sous-dossier `full-app/` provient du dépôt privé `gquthier/leadfactory-app`, commit `e909784b7a28982825b3a1b4d7ee0ff8b27e9bf1`. Aucune licence publique n’a été constatée dans cette source ; la licence MIT du kit ne lui est pas étendue. Voir `full-app/NOTICE.md`. Garder le dépôt et les exports privés.
