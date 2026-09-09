---
name: shopify-themes
description: Develop Shopify themes — file structure, Online Store 2.0, sections and
  blocks, settings schema, Dawn reference theme, Theme Check linting, asset pipeline,
  and theme deployment. Use when building or customizing Shopify themes.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch
license: MIT
metadata:
  upstream: OrcaQubits/agentic-commerce-skills-plugins
---

## BizOS E-commerce workspace

Use the owner’s brief and current authorizations. First check which tools are actually available; this skill does not install or connect them. Read current official platform documentation before executing version-dependent commands. Record findings and deliverables with the `commerce_*` tools so they appear in Apps. Keep observed data, estimates and hypotheses separate. A preview, draft or prompt is not a published store, campaign or generated media file.



# Shopify Theme Development

## Before writing code

**Fetch live docs**:
1. Fetch `https://shopify.dev/docs/storefronts/themes` for theme documentation
2. Web-search `site:shopify.dev theme architecture online store 2.0` for OS 2.0 patterns
3. Web-search `site:shopify.dev theme section schema blocks` for section and block schema
4. Web-search `site:github.com shopify dawn` for Dawn reference theme source
5. Web-search `site:shopify.dev settings schema json` for theme settings input types

## Theme File Structure

```
theme/
├── assets/           # CSS, JS, images, fonts
├── config/
│   ├── settings_schema.json    # Theme-level settings definition
│   └── settings_data.json      # Current settings values
├── layout/
│   ├── theme.liquid             # Main layout (required)
│   └── password.liquid          # Password page layout
├── locales/
│   ├── en.default.json          # Default translations
│   └── fr.json                  # Additional languages
├── sections/                    # Reusable, configurable sections
├── snippets/                    # Reusable Liquid fragments
├── templates/
│   ├── index.json               # Homepage
│   ├── product.json             # Product page
│   ├── collection.json          # Collection page
│   ├── page.json                # Static page
│   ├── blog.json                # Blog listing
│   ├── article.json             # Blog article
│   ├── cart.json                # Cart page
│   ├── 404.json                 # Not found
│   └── customers/
│       ├── login.json           # Login page
│       └── account.json         # Account dashboard
└── templates/*.json             # All OS 2.0 templates are JSON
```

## Online Store 2.0

The current theme architecture:
- **JSON templates** define which sections appear on each page type
- **Sections everywhere** — merchants can add/remove/reorder sections on any page
- **Blocks** — nested configurable units within sections
- **App blocks** — apps can inject content into themes via theme app extensions
- **Dynamic sources** — metafields and metaobjects connect to section settings

### JSON Template Structure

```json
{
  "sections": {
    "main": {
      "type": "main-product",
      "settings": {}
    },
    "recommendations": {
      "type": "product-recommendations",
      "settings": {
        "heading": "You may also like"
      }
    }
  },
  "order": ["main", "recommendations"]
}
```

Templates reference section types by name. The `order` array controls rendering order. Merchants edit sections and their settings in the theme editor.

## Section Architecture

Sections are the building blocks of OS 2.0 themes:
1. Single `.liquid` file containing template + schema
2. Schema defines settings, blocks, presets, and enabled_on/disabled_on
3. Merchants configure via the theme editor (no code needed)

### Section Schema Pattern

```liquid
{% comment %} sections/featured-collection.liquid {% endcomment %}

<div class="featured-collection">
  <h2>{{ section.settings.heading }}</h2>
  {% for block in section.blocks %}
    {% case block.type %}
      {% when 'product_card' %}
        <div {{ block.shopify_attributes }}>
          {{ block.settings.product.title }}
        </div>
      {% when 'text' %}
        <p {{ block.shopify_attributes }}>{{ block.settings.text }}</p>
    {% endcase %}
  {% endfor %}
</div>

{% schema %}
{
  "name": "Featured Collection",
  "settings": [
    {
      "type": "text",
      "id": "heading",
      "label": "Heading",
      "default": "Featured Products"
    },
    {
      "type": "collection",
      "id": "collection",
      "label": "Collection"
    }
  ],
  "blocks": [
    {
      "type": "product_card",
      "name": "Product Card",
      "settings": [
        { "type": "product", "id": "product", "label": "Product" }
      ]
    },
    {
      "type": "text",
      "name": "Text Block",
      "settings": [
        { "type": "richtext", "id": "text", "label": "Text" }
      ]
    }
  ],
  "presets": [
    { "name": "Featured Collection" }
  ],
  "enabled_on": {
    "templates": ["index", "collection"]
  }
}
{% endschema %}
```

### Setting Input Types

| Type | Renders As | Example Use |
|------|-----------|-------------|
| `text` | Text input | Headings, labels |
| `textarea` | Multi-line text | Descriptions |
| `richtext` | Rich text editor | Formatted content |
| `number` | Number input | Counts, spacing |
| `checkbox` | Toggle | Show/hide elements |
| `select` | Dropdown | Layout options |
| `color` | Color picker | Theme colors |
| `font_picker` | Font selector | Typography |
| `image_picker` | Image upload | Hero images, logos |
| `url` | URL input | Links |
| `product` | Product picker | Featured products |
| `collection` | Collection picker | Featured collections |
| `page` | Page picker | Links to pages |
| `blog` | Blog picker | Blog references |

> **Fetch live docs** for the full list of setting input types — new types are added (e.g., `color_scheme`, `inline_richtext`). Web-search `site:shopify.dev theme input settings types`.

### Settings Schema (config/settings_schema.json)

Defines theme-wide settings organized into groups (tabs in theme editor):
- Each group has a `name` and array of `settings`
- Accessed via `{{ settings.setting_id }}` in Liquid
- Controls: colors, typography, social media, layout, custom CSS

> **Fetch live docs** for current settings_schema.json structure — the format and available group types evolve.

## Dawn Reference Theme

Shopify's official reference theme:
- Minimal, accessible, performant
- Demonstrates all OS 2.0 patterns
- GitHub: `https://github.com/Shopify/dawn`
- Used as starting point for custom themes
- Read Dawn source to understand section/block patterns before building custom themes

## Theme Development Workflow

1. `shopify theme init` — scaffold from Dawn or create blank theme
2. `shopify theme dev` — local development server with hot reload
3. `shopify theme check` — lint for errors and best practices
4. `shopify theme push` — upload to development store
5. Test in theme editor — verify merchant customization
6. `shopify theme publish` — make theme live

## Theme Check

Linting tool for Shopify themes:
- Catches Liquid syntax errors
- Warns about deprecated features
- Enforces accessibility standards
- Performance suggestions
- Run: `shopify theme check` or configure in CI

> **Fetch live docs**: Web-search `site:shopify.dev theme check` for current rules and configuration options.

## Deprecated Tools Warning

- **Slate** — deprecated build tool. Use Shopify CLI (`shopify theme dev`)
- **Theme Kit** — legacy deployment. Use `shopify theme push`/`shopify theme pull`
- **Timber** — deprecated starter theme. Use Dawn

## Best Practices

- Start from Dawn for custom themes — do not build from scratch
- Use JSON templates for all page types (Online Store 2.0)
- Make sections reusable with well-defined schemas
- Use blocks for repeatable content within sections
- Keep JavaScript minimal — prefer CSS for animations and interactions
- Use `image_url` with width parameters for responsive images
- Run Theme Check before every deployment
- Test accessibility with keyboard navigation and screen readers
- Use locales for all user-facing text (even for single-language stores)
- Keep asset file sizes small — Shopify CDN serves them, but initial load matters
- Use `{{ block.shopify_attributes }}` on block wrappers for theme editor integration

Fetch the Shopify theme documentation, Dawn source, and section schema reference for exact schema options, setting types, and best practices before implementing.
