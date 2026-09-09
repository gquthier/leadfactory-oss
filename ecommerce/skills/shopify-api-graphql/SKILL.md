---
name: shopify-api-graphql
description: Use Shopify GraphQL APIs — Admin API for server-side CRUD, Storefront
  API for client-side queries, versioning, cost-based rate limiting, bulk operations,
  pagination. Use when integrating with Shopify data.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch
license: MIT
metadata:
  upstream: OrcaQubits/agentic-commerce-skills-plugins
---

## BizOS E-commerce workspace

Use the owner’s brief and current authorizations. First check which tools are actually available; this skill does not install or connect them. Read current official platform documentation before executing version-dependent commands. Record findings and deliverables with the `commerce_*` tools so they appear in Apps. Keep observed data, estimates and hypotheses separate. A preview, draft or prompt is not a published store, campaign or generated media file.



# Shopify GraphQL APIs

## Before writing code

**Fetch live docs**:
1. Fetch `https://shopify.dev/docs/api/admin-graphql` for Admin API schema
2. Fetch `https://shopify.dev/docs/api/storefront` for Storefront API schema
3. Web-search `site:shopify.dev graphql api versioning` for current API versions

## Two APIs

### Admin API (Server-Side)

Full CRUD on all store resources:
- Endpoint: `https://{store}.myshopify.com/admin/api/{version}/graphql.json`
- Auth: `X-Shopify-Access-Token` header
- Use for: product management, order processing, customer data, metafields, fulfillment
- Rate limit: cost-based, max 1,000 points per query. Restore rate varies by plan (100 pts/s Standard, 200 Advanced, 1,000 Plus)

### Storefront API (Client-Side)

Read-heavy access for custom storefronts:
- Endpoint: `https://{store}.myshopify.com/api/{version}/graphql.json`
- Auth: `X-Shopify-Storefront-Access-Token` header
- Use for: product browsing, cart operations, checkout, customer account
- Rate limit: cost-based (separate budget from Admin API)

## API Versioning

Quarterly releases: `YYYY-MM` (January, April, July, October)
- Each version supported for 12 months after release
- `unstable` version available for testing upcoming changes
- Always specify version in URL path

## Admin API Examples

### Query Products

```graphql
query Products($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges {
      node {
        id
        title
        handle
        status
        variants(first: 10) {
          edges {
            node {
              id
              title
              price
              sku
              inventoryQuantity
            }
          }
        }
        metafields(first: 5) {
          edges {
            node {
              namespace
              key
              value
              type
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

### Create Product

```graphql
mutation ProductCreate($input: ProductInput!) {
  productCreate(input: $input) {
    product {
      id
      title
    }
    userErrors {
      field
      message
    }
  }
}
```

### Bulk Operations

For large data exports:

```graphql
mutation {
  bulkOperationRunQuery(
    query: """
    {
      products {
        edges {
          node {
            id
            title
            variants {
              edges {
                node { id sku price }
              }
            }
          }
        }
      }
    }
    """
  ) {
    bulkOperation {
      id
      status
    }
    userErrors { field message }
  }
}
```

Poll for completion, then download JSONL result file.

## Storefront API Examples

### Query Products

```graphql
query Products($first: Int!) {
  products(first: $first) {
    edges {
      node {
        id
        title
        handle
        priceRange {
          minVariantPrice { amount currencyCode }
        }
        images(first: 1) {
          edges {
            node { url altText }
          }
        }
      }
    }
  }
}
```

### Cart Operations

```graphql
mutation CartCreate($input: CartInput!) {
  cartCreate(input: $input) {
    cart {
      id
      lines(first: 10) {
        edges {
          node {
            id
            quantity
            merchandise {
              ... on ProductVariant {
                id
                title
                price { amount currencyCode }
              }
            }
          }
        }
      }
      cost {
        totalAmount { amount currencyCode }
      }
      checkoutUrl
    }
    userErrors { field message }
  }
}
```

## Cost-Based Rate Limiting

Each query has a calculated cost:
- Single object field: 1 point
- Connection (list): 2 points + (first * child cost)
- Maximum single query cost: 1,000 points (enforced before execution)
- Restore rate by plan: 100 pts/s (Standard), 200 (Advanced), 1,000 (Plus), 2,000 (Enterprise)
- Throttle info in response extensions: `extensions.cost.throttleStatus`
- Handle throttled responses with backoff based on `retryAfter`

## Pagination

Relay-style cursor pagination:
- Forward: `first` + `after` (from `pageInfo.endCursor`)
- Backward: `last` + `before` (from `pageInfo.startCursor`)
- Always check `pageInfo.hasNextPage` / `pageInfo.hasPreviousPage`

## Python SDK

The official `ShopifyAPI` package (GitHub: `Shopify/shopify_python_api`) provides a Python client:
- Install: `pip install ShopifyAPI`
- Supports both REST (legacy) and GraphQL APIs
- Handles authentication, rate limiting, and pagination
- Useful for backend scripts and data pipelines

## Best Practices

- Use GraphQL Admin API (not REST) — REST is deprecated
- Always specify the API version in requests
- Request only the fields you need to minimize query cost
- Use bulk operations for large data exports (> 250 items)
- Handle rate limits gracefully with exponential backoff
- Use cursor pagination, not offset-based
- Check `userErrors` in mutation responses — a 200 status does not mean success
- Cache stable data (product info, collections) to reduce API calls

Fetch the Shopify GraphQL API reference for the current schema, available queries/mutations, and latest API version before implementing.
