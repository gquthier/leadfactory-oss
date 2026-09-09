---
name: shopify-liquid
description: Write Shopify Liquid templates — objects, tags, filters, global objects,
  section schema, Online Store 2.0 JSON templates, and Liquid best practices. Use
  when customizing Shopify theme templates.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch
license: MIT
metadata:
  upstream: OrcaQubits/agentic-commerce-skills-plugins
---

## BizOS E-commerce workspace

Use the owner’s brief and current authorizations. First check which tools are actually available; this skill does not install or connect them. Read current official platform documentation before executing version-dependent commands. Record findings and deliverables with the `commerce_*` tools so they appear in Apps. Keep observed data, estimates and hypotheses separate. A preview, draft or prompt is not a published store, campaign or generated media file.



# Shopify Liquid Templating

## Before writing code

**Fetch live docs**:
1. Fetch `https://shopify.dev/docs/api/liquid` for Liquid reference
2. Web-search `site:shopify.dev liquid objects` for available objects
3. Web-search `site:shopify.dev liquid filters` for available filters

## What Is Liquid

Liquid is Shopify's template language:
- Ruby-based, open-source (created by Shopify)
- Renders on Shopify's servers — no client-side execution
- Three building blocks: **objects**, **tags**, **filters**
- Shopify extends standard Liquid with commerce-specific objects and filters

## Objects

Access data with double curly braces:
- `{{ product.title }}` — product name
- `{{ product.price | money }}` — formatted price
- `{{ cart.item_count }}` — number of items in cart

### Key Global Objects

| Object | Description |
|--------|-------------|
| `product` | Current product (on product pages) |
| `collection` | Current collection |
| `cart` | Shopping cart |
| `customer` | Logged-in customer (nil if guest) |
| `shop` | Store settings |
| `request` | Current request (locale, page type) |
| `content_for_header` | Required scripts/meta (must be in layout) |
| `content_for_layout` | Template content (must be in layout) |
| `all_products` | Access any product by handle |
| `collections` | All collections |
| `linklists` | Navigation menus |
| `pages` | CMS pages |
| `settings` | Theme settings |

## Tags

Control flow and logic:

### Control Flow
```liquid
{% if product.available %}
  <span>In stock</span>
{% elsif product.variants.size > 0 %}
  <span>Limited</span>
{% else %}
  <span>Sold out</span>
{% endif %}

{% unless customer %}
  <a href="/account/login">Log in</a>
{% endunless %}

{% case product.type %}
  {% when 'Shirt' %}
    <p>Clothing</p>
  {% when 'Mug' %}
    <p>Accessories</p>
{% endcase %}
```

### Iteration
```liquid
{% for product in collection.products %}
  <h2>{{ product.title }}</h2>
{% endfor %}

{% for item in cart.items limit:5 offset:2 %}
  {{ item.title }}
{% endfor %}

{% paginate collection.products by 12 %}
  {% for product in collection.products %}
    {{ product.title }}
  {% endfor %}
  {{ paginate | default_pagination }}
{% endpaginate %}
```

### Variable
```liquid
{% assign greeting = 'Hello' %}
{% capture full_greeting %}{{ greeting }}, {{ customer.first_name }}!{% endcapture %}
```

## Filters

Transform output:
- **String**: `upcase`, `downcase`, `strip`, `truncate`, `replace`, `split`, `url_encode`
- **Number**: `plus`, `minus`, `times`, `divided_by`, `round`, `ceil`, `floor`
- **Money**: `money`, `money_with_currency`, `money_without_trailing_zeros`
- **Date**: `date: '%B %d, %Y'`
- **Array**: `first`, `last`, `size`, `sort`, `map`, `where`, `join`, `uniq`
- **HTML**: `img_tag`, `script_tag`, `stylesheet_tag`
- **URL**: `asset_url`, `img_url`, `file_url`, `shopify_asset_url`
- **Media**: `image_url`, `image_tag` (modern replacements for `img_url`/`img_tag`)

## Section Schema

Sections define their own settings in a `{% schema %}` tag:

```liquid
{% schema %}
{
  "name": "Featured Product",
  "settings": [
    {
      "type": "product",
      "id": "product",
      "label": "Product"
    },
    {
      "type": "color",
      "id": "background_color",
      "label": "Background color",
      "default": "#ffffff"
    }
  ],
  "blocks": [
    {
      "type": "text",
      "name": "Text block",
      "settings": [
        {
          "type": "richtext",
          "id": "content",
          "label": "Content"
        }
      ]
    }
  ],
  "presets": [
    {
      "name": "Featured Product"
    }
  ]
}
{% endschema %}
```

## JSON Templates (Online Store 2.0)

Templates are JSON files that reference sections:

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

## Deprecated — Do NOT Reference

- **Timber** — deprecated starter theme; use Dawn instead
- Section-only themes without JSON templates (pre-Online Store 2.0)

## Best Practices

- Use `image_url` and `image_tag` instead of deprecated `img_url` / `img_tag`
- Use JSON templates for all page types (Online Store 2.0)
- Keep logic minimal — Liquid is a template language, not a programming language
- Use `{% comment %}` for documentation, not HTML comments (which are sent to the browser)
- Use snippets (`{% render 'snippet-name' %}`) for reusable code — `{% include %}` is deprecated
- Use `{% render %}` over `{% include %}` — render creates an isolated scope
- Apply `| escape` filter to user-generated content to prevent XSS
- Use section settings for merchant-configurable values instead of hardcoding

Fetch the Shopify Liquid reference for exact object properties, available filters, and section schema options before implementing.
