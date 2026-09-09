---
name: shopify-catalog
description: Manage Shopify catalog — Product, Variant, and Option models, collections,
  metafields and metaobjects, inventory management, product taxonomy, bulk operations,
  and media. Use when working with Shopify product data.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch
license: MIT
metadata:
  upstream: OrcaQubits/agentic-commerce-skills-plugins
---

## BizOS E-commerce workspace

Use the owner’s brief and current authorizations. First check which tools are actually available; this skill does not install or connect them. Read current official platform documentation before executing version-dependent commands. Record findings and deliverables with the `commerce_*` tools so they appear in Apps. Keep observed data, estimates and hypotheses separate. A preview, draft or prompt is not a published store, campaign or generated media file.



# Shopify Catalog Management

## Before writing code

**Fetch live docs**:
1. Web-search `site:shopify.dev graphql admin api product` for product queries and mutations
2. Web-search `site:shopify.dev metafields metaobjects` for custom data APIs
3. Web-search `site:shopify.dev inventory management api` for inventory operations
4. Fetch `https://shopify.dev/docs/api/admin-graphql` and search for `productCreate`, `metafieldsSet`, `bulkOperationRunQuery` for current input schemas
5. Web-search `site:shopify.dev product variant options 2025` for latest variant limits and option changes

## Product Model

### Hierarchy

```
Product
├── Title, description, vendor, type, tags
├── Status: ACTIVE, DRAFT, ARCHIVED
├── Options (up to 3): Size, Color, Material
├── Variants (combinations of options)
│   ├── Price, compare-at price
│   ├── SKU, barcode
│   ├── Inventory (per location)
│   └── Weight, dimensions
├── Media (images, video, 3D models)
├── Metafields (custom data)
└── Collections (many-to-many)
```

### Options vs Variants

- **Options** define the axes of variation (e.g., Size, Color) — max 3 per product
- **Variants** are specific combinations of option values (e.g., Small/Red, Medium/Blue)
- A product with 3 sizes and 4 colors = 12 variants
- Each variant has its own price, SKU, inventory, and barcode
- Maximum 2,000 variants per product (increased from 100 in 2024 — verify current limit in live docs)

### Key Mutations

| Operation | Mutation | Notes |
|-----------|----------|-------|
| Create product | `productCreate` | Returns product ID + userErrors |
| Update product | `productUpdate` | Partial updates supported |
| Delete product | `productDelete` | Removes all variants and media |
| Create variant | `productVariantCreate` | Specify options + price + inventory |
| Bulk update variants | `productVariantsBulkUpdate` | Up to 100 variants per call |
| Manage media | `productCreateMedia` | Images, video, 3D models |
| Set metafield | `metafieldsSet` | Works on any resource |

> **Fetch live docs** for exact mutation input types and required fields — these evolve with each quarterly API version.

### Minimal Query Pattern

```graphql
# Pattern: paginated product query with cursor
# Fetch live docs for current available fields
query Products($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges {
      node {
        id
        title
        handle
        status
        variants(first: 10) {
          edges { node { id sku price } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

## Collections

Two types:
- **Manual collections** — merchant adds products individually
- **Smart collections** — rule-based automatic membership (tags, price, vendor, type, etc.)

Smart collection rules support: `tag`, `title`, `type`, `vendor`, `variant_price`, `variant_compare_at_price`, `variant_weight`, `variant_inventory`, `variant_title`.

## Metafields

Typed key-value pairs on any resource:
- Namespace + key = unique identifier (e.g., `custom.care_instructions`)
- Accessible from Liquid: `{{ product.metafields.custom.care_instructions.value }}`
- Configurable for Storefront API access via metafield definition

### Metafield Types

| Type | Example Value | Use Case |
|------|--------------|----------|
| `single_line_text` | `"Organic cotton"` | Short text |
| `multi_line_text` | `"Line 1\nLine 2"` | Descriptions |
| `number_integer` | `42` | Counts, quantities |
| `number_decimal` | `3.14` | Measurements |
| `boolean` | `true` | Flags |
| `date` | `"2025-01-15"` | Dates |
| `json` | `{"key": "value"}` | Structured data |
| `url` | `"https://..."` | Links |
| `color` | `"#FF0000"` | Colors |
| `file_reference` | GID | Images, files |
| `product_reference` | GID | Related products |
| `list.single_line_text` | `["a", "b"]` | Multi-value |

> **Fetch live docs** for the full list of metafield types — new types are added periodically (e.g., `money`, `rating`, `dimension`).

### Metafield Pattern

```graphql
# Pattern: set metafields on any resource
mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value }
    userErrors { field message }
  }
}
# Fetch live docs for MetafieldsSetInput fields — ownerId, namespace, key, type, value
```

## Metaobjects

Standalone custom content types:
- Define schema with fields and types (similar to metafield types)
- Create entries (instances) via `metaobjectCreate`
- Usable in themes via section settings (dynamic sources)
- Queryable via Admin and Storefront APIs
- Use cases: size charts, FAQs, team members, custom lookbooks

> **Fetch live docs**: Web-search `site:shopify.dev metaobject definition create` for schema creation and entry management.

## Inventory

Multi-location inventory tracking:
- `inventoryAdjustQuantities` — adjust stock by delta (+/-)
- `inventorySetQuantities` — set absolute quantity
- Inventory items linked to variants (one-to-one)
- Fulfillment service integration for third-party warehouses
- Reason codes: `received`, `correction`, `shrinkage`, `promotion`, etc.

> **Fetch live docs** for `InventoryAdjustQuantitiesInput` fields — the input shape and available reason codes evolve.

## Product Taxonomy

Shopify's standard product taxonomy:
- Structured category hierarchy (e.g., Apparel > Shirts > T-Shirts)
- Used for: tax calculations, product feeds, Shop app categorization
- Set via `productCategory` field on products
- Recommended for all products for accurate tax and discoverability

## Bulk Operations

For large catalog operations (> 250 items):

### Export Pattern

1. `bulkOperationRunQuery` — submit a GraphQL query for bulk export
2. Poll with `currentBulkOperation` query until status is `COMPLETED`
3. Download JSONL result from the `url` field
4. Each line is a JSON object (parent-child relationships via `__parentId`)

### Import Pattern

1. `stagedUploadsCreate` — get a presigned URL
2. Upload JSONL file with product data
3. `bulkOperationRunMutation` — process the staged upload
4. Poll for completion

> **Fetch live docs**: Web-search `site:shopify.dev bulk operations` for current input format, JSONL structure, and polling patterns.

## Best Practices

- Use GraphQL mutations (not REST) for all catalog operations
- Set metafield types explicitly — untyped metafields are deprecated
- Use bulk operations for imports/exports over 250 items
- Use smart collections for dynamic grouping
- Optimize images before upload — Shopify CDN serves them but original size affects processing
- Use product taxonomy for accurate categorization
- Store custom product data in metafields, not tags (tags are untyped strings)
- Always check `userErrors` in mutation responses — 200 status does not mean success
- Use cursor pagination for product listing (not offset-based)

Fetch the Shopify product and metafield API documentation for exact mutation inputs, metafield types, and bulk operation patterns before implementing.
