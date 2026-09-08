# Matrice de variations

Objectif : un pack équilibré et testable, pas du volume. Chaque cellule isole **une** variable de test.

```json
{
  "client": "…",
  "defaults": {"resolution": "2k", "model": "…"},
  "angles": ["white-space-1", "pain-led-1", "proof-led-1", "mechanism", "contrarian", "authority"],
  "formats": {"feed-4x5": 0.6, "story-9x16": 0.25, "feed-1x1": 0.15},
  "styles": ["photo-doc", "editorial-typo", "dataviz", "quote", "infographic", "split", "mockup"],
  "cells": [
    {"id": "A1-feed-photo", "angle": "pain-led-1", "format": "feed-4x5", "style": "photo-doc",
     "concept": "ios-notes", "test_variable": "hook",
     "copy": {"hook": "…", "sub": "…", "body": "…", "cta": "AUDIT GRATUIT", "trace": ["V", "P"]},
     "refs": ["brand_assets/logo.png"], "prompt": "…"}
  ]
}
```

`test_variable` ∈ `hook` | `visual_style` | `concept_format` | `cta` | `color_archetype` | `format` | `proof_element`.

Règles : jamais d'angle saturé sans retournement · jamais 12 variations du même style éditorial (erreur la plus fréquente ; les formats natifs battent souvent le « beau branding ») · au moins un concept par famille (natif, éditorial, preuve, produit).
