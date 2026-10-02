# Change Tracking

After every successful write operation, log the change to `{data_dir}/change-log.json`.

## Change log entry format

Append to the `changes` array:

```json
{
  "id": "chg_<unix_timestamp_ms>",
  "timestamp": "<ISO 8601>",
  "action": "<action_type>",
  "summary": "<specific one-liner, e.g. 'Paused 5 non-converting keywords in Example Service - Local saving ~$340/month'>",
  "details": {
    "campaignId": "<if applicable>",
    "campaignName": "<if applicable>",
    "affectedEntities": ["<IDs>"],
    "entityNames": ["<keyword text or campaign names>"]
  },
  "beforeSnapshot": {
    "metrics": { "spend30d": 0, "clicks30d": 0, "conversions30d": 0, "cpa30d": 0, "ctr30d": 0 },
    "note": "Metrics for affected entities at time of change"
  },
  "changeIds": ["<changeId(s) returned by write tool>"],
  "reviewAfter": "<ISO 8601 -- 7d for bid/keyword changes, 14d for structural>",
  "reviewWindow": "<7d or 14d>",
  "reviewed": false,
  "reviewResult": null
}
```

## Rules

- **Capture before-metrics** from data already in context. If none available: `"beforeSnapshot": { "metrics": null, "note": "No pre-change metrics" }`.
- **Review windows:** Bid/keyword/negative/budget changes: 7 days. Campaign creates/pauses/restructures/ad copy: 14 days.
- **Tell the user:** "Change logged. A review task records the next check; its timing depends on conversion lag and sample size."
- **Max 200 entries** (remove oldest reviewed first).
- **Group related writes** in one session as a single entry.

## Revue dans BizOS

Créer une tâche `commerce_records` avec une échéance adaptée au délai de conversion et à la quantité de données. Cette tâche reste visible dans le dashboard ; elle ne lance aucun agent automatiquement. Aucun script de hook ou calendrier n’est fourni.
