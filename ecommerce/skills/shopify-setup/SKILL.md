---
name: shopify-setup
description: Set up a Shopify development environment — Shopify CLI installation,
  Partner account, development stores, environment variables, project structures for
  themes, apps, and Hydrogen. Use when starting a new Shopify project.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch
license: MIT
metadata:
  upstream: OrcaQubits/agentic-commerce-skills-plugins
---

## BizOS E-commerce workspace

Use the owner’s brief and current authorizations. First check which tools are actually available; this skill does not install or connect them. Read current official platform documentation before executing version-dependent commands. Record findings and deliverables with the `commerce_*` tools so they appear in Apps. Keep observed data, estimates and hypotheses separate. A preview, draft or prompt is not a published store, campaign or generated media file.



# Shopify Development Setup

## Before writing code

**Fetch live docs**:
1. Fetch `https://shopify.dev/docs/api/shopify-cli` for CLI installation and commands
2. Web-search `site:shopify.dev getting started app development` for app setup
3. Web-search `site:shopify.dev theme development getting started` for theme setup

## Prerequisites

### Shopify Partner Account

All Shopify development starts with a Partner account:
- Free at https://partners.shopify.com/
- Provides access to development stores (unlimited), app management, and theme development
- Development stores have full Shopify features without charges

### Development Stores

Two types:
- **Development store** — full-featured test store, cannot process real payments
- **Shopify Plus sandbox** — for testing Plus-specific features

### Shopify CLI

The primary development tool:
- Install: `npm install -g @shopify/cli` or `brew install shopify-cli`
- Authenticate: `shopify auth login`
- Key commands: `shopify app init`, `shopify theme init`, `shopify hydrogen init`

## Project Structures

### App Project (Remix)

```
shopify-app/
├── app/
│   ├── routes/
│   │   ├── app._index.tsx        # App dashboard
│   │   ├── app.products.tsx      # Products page
│   │   └── webhooks.tsx          # Webhook handler
│   ├── shopify.server.ts         # Shopify API client
│   └── root.tsx
├── extensions/
│   ├── my-function/              # Shopify Function
│   └── my-checkout-ui/           # Checkout UI extension
├── shopify.app.toml              # App configuration
├── package.json
└── .env
```

### Theme Project

```
my-theme/
├── assets/                       # CSS, JS, images
├── config/
│   ├── settings_schema.json      # Theme settings
│   └── settings_data.json        # Default settings values
├── layout/
│   └── theme.liquid              # Main layout
├── locales/                      # Translations
├── sections/                     # Reusable sections
├── snippets/                     # Reusable Liquid snippets
├── templates/
│   ├── index.json                # Homepage template
│   └── product.json              # Product page template
└── .shopify/                     # CLI metadata
```

### Hydrogen Project

```
hydrogen-storefront/
├── app/
│   ├── routes/
│   │   ├── ($locale)._index.tsx
│   │   ├── ($locale).products.$handle.tsx
│   │   └── ($locale).collections.$handle.tsx
│   ├── components/
│   ├── lib/
│   │   └── context.ts
│   └── root.tsx
├── server.ts
├── hydrogen.config.ts
├── remix.config.js
└── .env
```

## Environment Variables

```
SHOPIFY_API_KEY=your-api-key
SHOPIFY_API_SECRET=your-api-secret
SHOPIFY_APP_URL=https://your-app.example.com
SCOPES=read_products,write_products,read_orders
SHOPIFY_STORE=your-dev-store.myshopify.com
```

Never hardcode secrets — always use `.env` files (excluded from version control) or your platform's secret manager.

## Deprecated Technologies Warning

Do NOT use these deprecated tools:
- **Slate** — deprecated theme build tool, replaced by Shopify CLI
- **Theme Kit** — legacy theme deployment, replaced by `shopify theme` CLI commands
- **Timber** — deprecated starter theme, replaced by Dawn

## Best Practices

- Use `shopify app init` or `shopify theme init` to scaffold projects — do not set up manually
- Always start with a development store — never develop against a production store
- Use the latest stable API version (check `https://shopify.dev/docs/api/usage/versioning`)
- Keep `.env` in `.gitignore`
- Use `shopify app dev` for local development with hot reload and tunnel
- Run `shopify theme check` before deploying themes

Fetch the Shopify CLI docs and getting-started guides for exact commands and latest project structures before setting up.
