---
name: shopify-performance
description: Optimize Shopify performance — Liquid rendering, asset optimization,
  CDN strategies, Core Web Vitals, Hydrogen caching, image optimization, preloading,
  and lazy loading. Use when improving Shopify store speed.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch
license: MIT
metadata:
  upstream: OrcaQubits/agentic-commerce-skills-plugins
---

## BizOS E-commerce workspace

Use the owner’s brief and current authorizations. First check which tools are actually available; this skill does not install or connect them. Read current official platform documentation before executing version-dependent commands. Record findings and deliverables with the `commerce_*` tools so they appear in Apps. Keep observed data, estimates and hypotheses separate. A preview, draft or prompt is not a published store, campaign or generated media file.



# Shopify Performance Optimization

## Before writing code

**Fetch live docs**:
1. Web-search `site:shopify.dev theme performance` for theme optimization
2. Web-search `site:shopify.dev hydrogen caching` for Hydrogen caching strategies
3. Web-search `site:web.dev core web vitals` for current CWV guidelines and thresholds
4. Web-search `site:shopify.dev image optimization cdn` for image URL transforms
5. Web-search `site:shopify.dev theme speed report` for Shopify's built-in speed metrics

## Liquid Rendering Performance

### Template Optimization

- Minimize Liquid logic — complex loops and conditionals slow server-side rendering
- Use `{% render %}` (not `{% include %}`) — isolated scope prevents variable conflicts
- Avoid nested loops — `O(n²)` in Liquid is expensive
- Limit `forloop` iterations with `limit:` parameter
- Pre-compute values with `{% assign %}` instead of repeating expressions

### Object Access

- Access specific properties: `{{ product.title }}` not `{{ product | json }}`
- Avoid `all_products[handle]` in loops — each is a separate data lookup
- Use section settings to pass data instead of global lookups
- Minimize use of `{{ content_for_header }}` scripts (managed by Shopify — cannot remove, but minimize additional scripts)

### Liquid Anti-Patterns

| Anti-Pattern | Why It's Slow | Better Approach |
|-------------|--------------|-----------------|
| Nested `for` loops | O(n²) rendering | Flatten data, use single loop |
| `all_products[handle]` in loop | Data fetch per iteration | Pass products via section settings |
| `{% include %}` with variables | Shared scope causes conflicts | Use `{% render %}` (isolated) |
| Complex `{% if %}` chains | Evaluated every render | Simplify conditions, use `{% case %}` |
| Unused sections in templates | Rendered even if hidden | Remove from JSON template |

## Asset Optimization

### CSS

- Minimize CSS — remove unused styles
- Use `{{ 'style.css' | asset_url | stylesheet_tag }}` for proper caching
- Critical CSS: inline above-the-fold styles in `<head>`
- Defer non-critical CSS: `media="print" onload="this.media='all'"`

### JavaScript

- Defer non-critical JS: `<script defer>` or dynamic `import()`
- Minimize JS bundles — Shopify themes don't need frameworks for most UI
- Use native browser APIs over jQuery
- Load third-party scripts asynchronously (`async` attribute)
- Avoid render-blocking scripts in `<head>`

### Images

Shopify CDN image optimization:

```liquid
# Responsive images with srcset
{{ image | image_url: width: 800 }}
{{ image | image_url: width: 400 }}

# Srcset pattern
<img
  srcset="{{ image | image_url: width: 400 }} 400w,
         {{ image | image_url: width: 800 }} 800w,
         {{ image | image_url: width: 1200 }} 1200w"
  sizes="(max-width: 600px) 400px, (max-width: 1000px) 800px, 1200px"
  src="{{ image | image_url: width: 800 }}"
  alt="{{ image.alt }}"
  loading="lazy"
  width="{{ image.width }}"
  height="{{ image.height }}"
>
```

Key image practices:
- Use `loading="lazy"` for below-the-fold images
- Use `fetchpriority="high"` for LCP image
- Set explicit `width` and `height` to prevent layout shift
- Shopify CDN automatically serves WebP/AVIF when supported
- URL parameters: `?width=`, `?height=`, `?crop=`, `?format=`

> **Fetch live docs**: Web-search `site:shopify.dev image_url filter parameters` for current CDN transform options — new parameters are added over time.

## Core Web Vitals

### LCP (Largest Contentful Paint)

Target: < 2.5 seconds

- Preload hero/LCP image: `<link rel="preload" as="image" href="{{ image | image_url: width: 1200 }}">`
- Use `fetchpriority="high"` on LCP image
- Avoid lazy-loading above-the-fold images
- Minimize render-blocking CSS and JS
- Use server-side rendering (Liquid or Hydrogen SSR)

### CLS (Cumulative Layout Shift)

Target: < 0.1

- Set explicit `width` and `height` on all images and media
- Reserve space for dynamic content (ads, embeds, lazy-loaded images)
- Avoid inserting content above existing content after page load
- Use `aspect-ratio` CSS property for responsive media containers
- Avoid dynamically injected banners or pop-ups that shift content

### INP (Interaction to Next Paint)

Target: < 200ms

- Minimize main-thread blocking JavaScript
- Break up long tasks with `requestIdleCallback` or `setTimeout(fn, 0)`
- Use CSS for animations and transitions (not JS)
- Debounce event handlers (scroll, resize, input)
- Avoid synchronous layout thrashing (read-then-write DOM patterns)

> **Fetch live docs**: CWV thresholds and measurement methodology evolve. Web-search `site:web.dev core web vitals thresholds` for current targets.

## Hydrogen Caching

### Cache Strategies

```typescript
// Pattern: apply cache strategy to storefront query
const data = await storefront.query(QUERY, {
  cache: CacheLong(),  // products, collections
});

const cart = await storefront.query(CART_QUERY, {
  cache: CacheShort(), // dynamic data
});
```

| Strategy | Use For |
|----------|---------|
| `CacheLong()` | Products, collections, pages |
| `CacheShort()` | Cart, personalized content |
| `CacheNone()` | Customer-specific data |
| `CacheCustom({...})` | Fine-tuned scenarios |

> **Fetch live docs** for exact TTL values — Hydrogen caching defaults may change across versions.

### Streaming SSR

- Use `defer()` in loaders for non-critical data
- Critical data renders immediately, deferred data streams in
- Show loading states with `<Suspense>` + `<Await>`
- Preload routes with `<Link prefetch="intent">`

## Shopify CDN

Shopify's global CDN:
- Automatic for all theme assets and images
- Cache-Control headers managed by Shopify
- Image transformations via URL parameters
- No manual CDN configuration needed for themes
- Asset fingerprinting for cache busting

## Measurement Tools

| Tool | What It Measures |
|------|-----------------|
| Shopify Theme Speed Report | Overall theme score in admin |
| Google Lighthouse | CWV + performance audit |
| WebPageTest | Real-world loading waterfall |
| Chrome DevTools Performance | JS profiling, layout shifts |
| Search Console CWV Report | Field data from real users |

## Best Practices

- Measure before optimizing — use Lighthouse, WebPageTest, Shopify's theme speed report
- Focus on LCP image optimization first (biggest impact for most stores)
- Lazy-load everything below the fold
- Minimize third-party scripts (analytics, chat widgets, social embeds)
- Use Shopify's built-in analytics over custom tracking scripts where possible
- For Hydrogen: cache aggressively, stream non-critical data, preload routes
- Test on real devices and slow connections (3G throttling)
- Set explicit dimensions on all media to prevent CLS
- Use `font-display: swap` for custom fonts

Fetch the Shopify performance documentation, Core Web Vitals guides, and Hydrogen caching docs for exact optimization techniques and current best practices before implementing.
