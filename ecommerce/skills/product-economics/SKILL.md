---
name: product-economics
description: Evaluate supplier options and ecommerce unit economics with explicit
  assumptions. Use before validating a product, choosing a supplier, pricing an offer
  or setting a test budget.
license: MIT
---

# Product economics

Collect supplier quote/date/currency, minimum order, samples, lead time, quality checks, product cost, shipping, fulfilment, payment fees, expected refunds/returns and taxes relevant to the owner's market. Unknown inputs are hypotheses, never zero by default in the analysis.

Calculate on a consistent tax/currency basis:

- Net sales per order after discounts and expected refunds.
- Variable non-ad cost per order: landed goods, fulfilment/shipping subsidy, payment fees and expected return/support costs.
- Contribution before acquisition = net sales minus variable non-ad costs.
- Break-even acquisition cost = contribution before acquisition. Target acquisition cost must leave the owner's chosen contribution margin.
- Fixed costs and cash requirements are separate. Any fixed-cost allocation per order states the assumed order volume.

Show conservative, central and favorable cases; label estimates and sensitivity to returns, shipping and conversion. A positive spreadsheet does not validate demand. An unknown acquisition cost calls for a bounded test, not a claim of profitability.

Compare suppliers by verified terms and sample quality. Record products/suppliers through `commerce_records`, and the calculation with assumptions and date as a `sourcing` deliverable. The dashboard's price/cost/shipping fields are a partial record; store the complete calculation in the deliverable. Never place an order or spend a test budget solely because this skill was read.
