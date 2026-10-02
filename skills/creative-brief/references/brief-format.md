# Format du brief créatif

## `creative-brief.md`

```markdown
# Brief créatif — {Client} · {Campagne}
Canal : … · Objectif : … · Budget : … · Date : …

## 1. Identité de marque
## 2. Audience cible
## 3. Paysage concurrentiel
## 4. Templates créatifs
### T01 — {Nom} · {Format} · Angle : {Angle}
Headline : … · Sous-headline : …
- puce 1
- puce 2
- puce 3
Style : …
### T02 — …
## 5. Direction copywriting
## 6. Style visuel
## 7. Références et documents
## Informations manquantes
```

## `creative-brief.json`

```json
{
  "client": "…",
  "campaign": {"name": "…", "channel": "meta", "goal": "…", "budget": "…"},
  "brandIdentityHtml": "<h3>Marque</h3><p>…</p>",
  "targetAudienceHtml": "<h3>Persona</h3><p>…</p>",
  "competitiveLandscapeHtml": "<h3>Concurrents</h3><p>…</p>",
  "templates": [
    {"id": "tpl-01", "name": "…", "format": "Image statique 1080x1350", "angle": "Douleur",
     "headline": "…", "subHeadline": "…", "bulletPoints": ["…", "…", "…"], "styleDirection": "…"}
  ],
  "copywritingDirectionHtml": "<h3>Ton</h3><p>…</p>",
  "visualStyleHtml": "<h3>Palette</h3><p>…</p>",
  "referencesHtml": "<h3>Documents</h3><ul><li><a href=\"…\">…</a></li></ul>",
  "missingInformation": ["…"]
}
```

HTML simple uniquement : `p`, `h3`, `h4`, `strong`, `em`, `ul`, `ol`, `li`, `a`. Pas de CSS inline, pas de `div`.
