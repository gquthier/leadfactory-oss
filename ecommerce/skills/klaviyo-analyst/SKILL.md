---
name: klaviyo-analyst
description: Plan and review ecommerce email retention in Klaviyo. Use for welcome,
  abandoned-cart, post-purchase and win-back flows, with explicit consent and event
  checks.
license: MIT
---

# Klaviyo retention work

Adapted from Rebecca Rae Barton's MIT skill; see LICENSE.txt. Use the owner's connected account or work from an authorized export. Read current official documentation before changing account configuration: https://developers.klaviyo.com/en/docs and https://help.klaviyo.com/.

1. Identify the market, consent sources, sending-domain status, suppression rules and real events received from the store. Record missing access or missing events.
2. Inspect existing campaigns/flows before adding anything. For each proposed flow write trigger, eligibility, timing, exclusion after purchase, suppression after unsubscribe, exit conditions and duplicate prevention.
3. Draft a welcome, cart recovery or post-purchase sequence according to the actual objective. Cite product facts and approved offer terms; do not invent urgency or customer results.
4. Test with designated test profiles and events. Check links, personalization fallbacks, discounts, mobile rendering and suppression. Keep activation pending until the owner has authorized the concrete flow.
5. Report delivered mail, clicks, unsubscribes and revenue with the account's attribution window and date range. Separate observed account attribution from causal uplift. Compare variants only with a documented sample and baseline.

Record email copy in `creatives` with type `email`, the flow specification in `deliverables` at stage `retention`, and configuration work in `tasks`, using `commerce_*`. No Python client, package installation, sending account or active flow is bundled.
