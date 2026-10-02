---
name: ecommerce-orchestrator
description: Run an ecommerce project from product research to a tested Shopify store
  and ongoing operations. Use when starting an ecommerce business or coordinating
  its next stage in BizOS.
license: MIT
---

# Ecommerce project coordinator

Read the bound vault's `Business.md`, `NOW.md` and `Source map.md`, then `commerce_context` and `commerce_schema`. Work from the owner's current instructions; do not re-ask settled questions. Read only the product and stage required for the next task.

| Stage | Role | Concrete output | Skills to read when relevant |
|---|---|---|---|
| Research | Product Research | Dated candidate evidence and unknowns | amazon-product-research |
| Competitors | Product Research | Offer/page/ad comparison | ecommerce-competitor-analyzer, competitor-ads-analyst |
| Sourcing/economics | Product Research | Supplier quote, landed costs and scenarios | product-economics |
| Offer/brand | Director + Creative | Supported promise, price and identity | copywriting, brand-dna |
| Store | Store Builder | Theme code, product drafts, preview and checkout QA | shopify-setup, shopify-themes, shopify-liquid, shopify-catalog, shopify-testing, shopify-performance |
| Creative | Creative | Actual media files and copy with rights/review | ad-creative |
| Acquisition | Acquisition | Measured test plan and prepared campaign | meta-ads-audit, meta-ads, google-ads-audit, google-ads |
| Retention | Operations | Tested flow drafts and suppression rules | klaviyo-analyst |
| Operations | Operations | Order exceptions, service and dated review | ecommerce-operations, cro |

Each stage ends with an artifact, evidence, open inputs and an assigned next action. Some work can run in parallel, but store claims depend on product facts and a launch depends on checkout/measurement QA. The owner decides spending and publication within their existing authorization.

Use `commerce_records` to persist products, relationships, tasks and deliverables. Use `commerce_dashboard` for declarative layout changes; read the current configuration first. Files and previews go in the bound vault's relevant work folder. Only a successful tool result proves that the dashboard was updated.

See [worked example](references/worked-example.md) for a fictional complete handoff. A prompt is not an image; a preview is not a published store; a planned campaign is not a running one. Report the actual state.
