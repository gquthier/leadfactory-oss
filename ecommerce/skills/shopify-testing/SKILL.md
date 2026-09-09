---
name: shopify-testing
description: Test Shopify applications — app testing with Vitest and Playwright, theme
  testing with Theme Check, Function testing, webhook testing, extension testing,
  and CI/CD pipelines. Use when writing tests for Shopify projects.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch
license: MIT
metadata:
  upstream: OrcaQubits/agentic-commerce-skills-plugins
---

## BizOS E-commerce workspace

Use the owner’s brief and current authorizations. First check which tools are actually available; this skill does not install or connect them. Read current official platform documentation before executing version-dependent commands. Record findings and deliverables with the `commerce_*` tools so they appear in Apps. Keep observed data, estimates and hypotheses separate. A preview, draft or prompt is not a published store, campaign or generated media file.



# Shopify Testing

## Before writing code

**Fetch live docs**:
1. Web-search `site:shopify.dev testing apps` for app testing patterns
2. Web-search `site:shopify.dev theme check` for theme linting
3. Web-search `site:shopify.dev shopify functions testing` for function testing

## App Testing

### Unit Tests (Vitest)

The Remix template uses Vitest:

```typescript
// tests/routes/app._index.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { loader } from '~/routes/app._index';

describe('App index loader', () => {
  it('returns products', async () => {
    const context = {
      admin: {
        graphql: vi.fn().mockResolvedValue({
          json: () => ({ data: { products: { edges: [] } } }),
        }),
      },
    };

    const response = await loader({ context, request: new Request('http://test'), params: {} });
    const data = await response.json();
    expect(data.products).toBeDefined();
  });
});
```

### Integration Tests (Playwright)

End-to-end testing with a development store:

```typescript
import { test, expect } from '@playwright/test';

test('app loads in admin', async ({ page }) => {
  await page.goto('https://dev-store.myshopify.com/admin/apps/my-app');
  await expect(page.locator('[data-testid="app-page"]')).toBeVisible();
});
```

### Mocking Shopify APIs

```typescript
// Mock the admin GraphQL client
const mockAdmin = {
  graphql: vi.fn().mockImplementation((query) => {
    if (query.includes('products')) {
      return Promise.resolve({
        json: () => ({ data: { products: { edges: [] } } }),
      });
    }
  }),
};
```

## Theme Testing

### Theme Check

Static analysis for Liquid themes:
- `shopify theme check` — run all checks
- `shopify theme check --auto-correct` — fix auto-fixable issues
- Categories: errors, suggestions, style
- Checks: deprecated tags, missing templates, accessibility, performance

### Manual Theme Testing

- Test with `shopify theme dev` — live preview
- Test all page types: home, product, collection, cart, checkout
- Test responsive: mobile, tablet, desktop
- Test accessibility: keyboard, screen reader, color contrast

## Function Testing

### Local Testing

```bash
shopify app function run --input input.json
```

Create test input JSON files:

```json
{
  "cart": {
    "lines": [
      {
        "id": "gid://shopify/CartLine/1",
        "quantity": 2,
        "merchandise": {
          "__typename": "ProductVariant",
          "id": "gid://shopify/ProductVariant/123"
        }
      }
    ]
  }
}
```

### Unit Tests for Functions

```javascript
import { describe, it, expect } from 'vitest';
import { run } from '../src/run';

describe('discount function', () => {
  it('applies discount for VIP customers', () => {
    const input = {
      cart: { lines: [{ /* ... */ }] },
      discountNode: { metafield: { value: '{"percentage": 10}' } },
    };

    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].value.percentage.value).toBe('10.0');
  });

  it('returns empty discounts for non-VIP', () => {
    const input = { cart: { lines: [] }, discountNode: { metafield: null } };
    const result = run(input);
    expect(result.discounts).toHaveLength(0);
  });
});
```

## Webhook Testing

### Local Development

- Use `shopify app dev` — sets up a tunnel and registers webhooks locally
- Trigger events manually in development store admin
- Check webhook delivery logs in Partner dashboard

### Testing HMAC Verification

```typescript
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

function createTestWebhook(body: object, secret: string) {
  const bodyStr = JSON.stringify(body);
  const hmac = crypto.createHmac('sha256', secret).update(bodyStr).digest('base64');
  return { body: bodyStr, hmac };
}

describe('webhook verification', () => {
  it('verifies valid HMAC', () => {
    const { body, hmac } = createTestWebhook({ order: { id: 1 } }, 'test-secret');
    expect(verifyWebhook(body, hmac, 'test-secret')).toBe(true);
  });

  it('rejects invalid HMAC', () => {
    expect(verifyWebhook('{}', 'invalid', 'test-secret')).toBe(false);
  });
});
```

## CI/CD

### GitHub Actions Example

```yaml
name: Test Shopify App
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: shopify theme check (if theme)
```

## Best Practices

- Write unit tests for all Shopify Functions (they are pure functions — easy to test)
- Mock Shopify API responses in app unit tests
- Use Theme Check in CI to catch Liquid issues early
- Test webhook HMAC verification with both valid and invalid signatures
- Use development stores for integration testing — never test against production
- Test checkout extensions with actual checkout flows in development stores
- Include type checking (`tsc --noEmit`) in CI pipeline

Fetch the Shopify testing documentation for exact test patterns, Theme Check configuration, and CI/CD examples before implementing.
