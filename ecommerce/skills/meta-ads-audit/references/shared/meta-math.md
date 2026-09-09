# Meta Ads Math — Profitability and Performance Calculators

Formulas and interpretation rules used throughout the Meta Ads skills. Load this when a finding needs dollar-denominated impact, profitability framing, or a forecast.

**Priority rule:** When `business-context.json` has `profit_margin` and `aov`, use break-even-based thresholds. Otherwise fall back to account-average heuristics. Never mix the two in a single finding — the framing should be consistent.

Meta is creative-led, paid-social, and bought on impressions, not clicks. CPM is a primary lever (creative quality drives it down); CTR alone is not a goal — landing-page conversion rate and ROAS are.

---

## Core Formulas

```
CPM            = (Spend / Impressions) × 1000
CPC            = Spend / Link Clicks                  (link clicks, NOT all clicks)
CTR (link)     = Link Clicks / Impressions × 100      (use link CTR, not all-CTR)
Hook Rate      = 3-Sec Video Views / Impressions × 100 (video creative)
Hold Rate      = ThruPlays / 3-Sec Video Views × 100   (video creative)
CPA            = Spend / Results                       (results = the optimization event)
ROAS           = Purchase Conversion Value / Spend     (ratio, e.g. 3.5x)
ROAS%          = (Purchase Value - Spend) / Spend × 100
Frequency      = Impressions / Reach
CVR (LP)       = Landing Page Conversions / Landing Page Views × 100
```

**Always disambiguate "CTR" and "clicks" in Meta reports.** Meta surfaces both `clicks (all)` (which counts every click on the ad including profile, like, see-more) and `link clicks` (clicks that send the user to the destination). Optimization decisions use **link** clicks — total clicks are vanity. When pulling from `getInsights`, request `clicks`, `inline_link_clicks`, `cpc`, `ctr`, and the breakdown actions you need; treat `inline_link_clicks` as the real click count.

---

## Profitability Formulas (require margin + AOV)

```
Break-Even ROAS     = 1 / Profit Margin
Break-Even CPA      = AOV × Profit Margin
Max Profitable CPA  = Break-Even CPA                    (bid up to this, no higher)
Unit Profit         = AOV × Profit Margin - CPA
Headroom $          = (Break-Even CPA - Current CPA) × Monthly Conversions
```

**ROAS is the dominant frame for ecom.** Lead-gen and SaaS rely on CPA / CPL. For lead-gen, also compute `Lead-to-Customer Rate × AOV × Profit Margin` if the user has the lead-conversion data — the CPA off the platform is meaningless without a downstream rate.

| Headroom | Framing | Action |
|---|---|---|
| Negative | "Losing $X/month on this ad set" | Pause or restructure immediately |
| $0–$500/mo | "Barely break-even" | Refresh creative; tighten audience before scaling |
| $500–$2,000/mo | "Profitable but tight" | Selective scaling (CBO with cautious increments) |
| > $2,000/mo | "Strong unit economics" | Scale via duplication or +20% budget steps |

---

## LTV:CAC

```
CAC       = Total Marketing Spend / New Customers Acquired
LTV       = ARPU × Avg Customer Lifespan   (or use business-context.json.ltv if set)
LTV:CAC   = LTV / CAC
Payback   = CAC / (ARPU × Gross Margin)    (months to recover CAC)
```

| LTV:CAC | Interpretation |
|---|---|
| <1:1 | Losing money on every customer. Stop scaling immediately |
| 1:1–3:1 | Marginal. Viable only if payback period < 12 months |
| 3:1 | Healthy (SaaS / ecom benchmark) |
| 5:1+ | Under-investing in growth — you can afford to bid higher |

---

## Frequency, Saturation, and Audience Reach

```
Frequency Cap (cold)   ≤ 2.0/week before fatigue
Frequency Cap (warm)   2.0–3.5/week is normal for retargeting
Frequency Cap (red flag) > 4.0/week on cold prospecting
Audience Saturation    Reach / Estimated Audience Size
```

**Fatigue heuristic:** When a campaign's CPM rises ≥30% week-over-week with no creative change AND frequency > 3.0, the audience is saturated. The fix is fresh creative or a fresh audience — raising budget makes it worse.

**Audience size guidance:**

| Audience Size | Viability | Notes |
|---|---|---|
| < 1M | Too narrow for prospecting | Use as a custom-audience seed for lookalikes only |
| 1M–10M | Lookalike sweet spot | Most LAL 1–3% audiences land here |
| 10M–50M | Healthy interest / behavior cold audience | Allow Meta's algorithm room to optimize |
| > 50M | Broad targeting | Often the best for Advantage+ Shopping campaigns |

---

## Budget Forecasting

```
Projected Spend       = Daily Budget × Days in Period
Projected Conversions = Projected Spend / Historical CPA
Projected Revenue     = Projected Conversions × AOV
```

Present 3 scenarios, enforcing the **20% scaling rule** — Meta's learning phase resets when you change budget or targeting by more than ~20%, so larger steps cost a relearn:

| Scenario | Weekly Budget Increase | Caveat |
|---|---|---|
| Conservative | +20% | Stays out of significant edit territory; no relearn |
| Moderate | +50% over 3 weeks (+20%, +25%, +25% compounded) | Monitor CPA after each step; expect 3–7 days of noise |
| Aggressive | +100% over 5 weeks | Diminishing returns kick in; expect CPA to rise 15–25% |

Always show the **diminishing returns warning** for aggressive: "Doubling budget rarely doubles conversions on Meta — expect 1.5–1.7x conversions at 2x spend, plus a learning-phase reset that compresses signal for 3–7 days."

---

## MER (Marketing Efficiency Ratio)

```
MER = Total Business Revenue / Total Marketing Spend
```

Use MER when the user wants blended efficiency across Meta + other channels (Google, TikTok, organic). MER captures organic, brand, and retention — so it's higher than paid ROAS and should never be compared directly to in-platform ROAS.

| Industry | Typical MER | Excellent |
|---|---|---|
| Ecommerce | 3–5x | 8x+ |
| DTC subscription | 2–4x | 6x+ |
| Lead-gen B2C | 4–8x | 12x+ |

Meta's reported in-platform ROAS is increasingly higher than MER would suggest because attribution windows have narrowed (default 7-day click + 1-day view) while modeled conversions have grown. Always anchor scaling decisions on MER plus a holdout test where possible.

---

## Usage in Findings

**Before (account-average framing):**
> "Ad set 'LAL 3% — Skincare buyers' has a CPA of $42, which is 150% of account average."

**After (margin-aware framing, requires `margin=0.55`, `aov=$68` from business-context.json):**
> "Ad set 'LAL 3% — Skincare buyers' has CPA $42. Your Break-Even CPA is $37 (AOV $68 × 55% margin) — every conversion from this ad set is unprofitable by ~$5. ROAS is 1.62× vs. a Break-Even ROAS of 1.82×."

**Frequency-aware framing:**
> "Cold prospecting ad set 'LAL 1% — All buyers' is at frequency 4.6 with CPM up 38% week-over-week. The audience is saturated — refresh creative or rotate to a new lookalike seed before raising budget."

---

## Gates

1. **Never compute break-even without verified margin.** If `business-context.json.profit_margin` is missing or marked `inferred_from_template`, label the output "estimated from industry template (±20%)" and ask the user to confirm before any write operation.
2. **Never project conversions more than 2x current spend.** Diminishing returns make linear projections unreliable beyond that on Meta especially, where audience saturation is sharper than on Search.
3. **Never use MER in place of ROAS for individual-ad-set decisions.** MER is a blended portfolio metric; individual ad sets must clear ROAS or CPA targets.
4. **Always cite the attribution window when reporting ROAS.** "ROAS 3.2× (7-day click + 1-day view)" beats "ROAS 3.2×" — the window changes the number.
5. **Frequency > 3.5 with declining CTR is a creative problem, not a budget problem.** Refuse to recommend a budget increase under those conditions.
