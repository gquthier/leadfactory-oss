---
name: ecommerce-competitor-analyzer
description: Compare ecommerce competitors, storefronts, offers and advertising evidence.
  Use when researching positioning, competitor ads or a product shortlist.
license: MIT
---

# Ecommerce competitor evidence

Adapted from Buluslan's MIT skill; see LICENSE.txt. Use available browsing and the owner's authorized accounts.

For each competitor collect: product URL, ad-library URL when available, observation date, market/currency, price, shipping terms, offer, page structure, creative angle, stated proof and main objection. Preserve the exact source and distinguish your interpretation.

Compare direct alternatives and substitutes. Sample landing pages and ads relevant to the same market. Ad longevity, the presence of several ads and estimated traffic are signals to investigate; they do not prove revenue or profitability. A screenshot is evidence of what was displayed at that time.

Produce an original comparison and differentiation proposal. Do not copy another brand's creative assets, testimonials or unsupported claims into the owner's store. Use licensed assets and verified product facts.

Store observations in `competitors` through `commerce_records`, linked to the candidate product. Save the comparative brief in `deliverables` at stage `competitors`, and unknowns in tasks. Read `commerce_schema` for the actual fields.

External scrapers, ad libraries and spreadsheets are optional tools to connect separately. No script or OAuth configuration is assumed to exist in this pack.
