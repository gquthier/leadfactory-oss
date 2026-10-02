/**
 * Generate a Make.com (Integromat) blueprint JSON that wires:
 *
 *   Meta (Facebook) Lead Ads — Watch Leads
 *     ↓
 *   HTTP — Make a request (POST /api/integrations/webhook/<token>)
 *
 * The blueprint is meant to be imported into Make via "Create a new scenario
 * → Import Blueprint". After import the user only has to:
 *
 *   1. Connect their Facebook account (the Watch Leads module asks for it).
 *   2. Pick the Page + Lead form.
 *   3. Activate the scenario.
 *
 * The webhook URL (including the bearer-in-path key) is hard-coded into the
 * blueprint so it's bound to a specific LeadFactory client.
 */

export interface BlueprintInput {
  webhookUrl: string;
  clientLabel: string; // displayed in scenario name & metadata
}

export function buildMakeBlueprint({ webhookUrl, clientLabel }: BlueprintInput): unknown {
  return {
    name: `LeadFactory — Meta Lead Ads → ${clientLabel}`,
    flow: [
      {
        id: 1,
        module: "facebook-lead-ads:WatchLeads",
        version: 5,
        parameters: {
          // Filled in by the user after import.
          // We declare them so Make shows the form properly.
          page: "",
          form: "",
        },
        mapper: {},
        metadata: {
          designer: { x: 0, y: 0 },
          restore: {
            parameters: {
              page: { label: "Facebook Page" },
              form: { label: "Lead form" },
            },
          },
          parameters: [
            { name: "page", type: "select", label: "Page", required: true },
            { name: "form", type: "select", label: "Lead form", required: true },
          ],
        },
      },
      {
        id: 2,
        module: "http:ActionSendData",
        version: 3,
        parameters: {
          handleErrors: false,
          useNewZLibDeCompress: true,
        },
        mapper: {
          url: webhookUrl,
          method: "post",
          headers: [
            { name: "Content-Type", value: "application/json" },
            { name: "User-Agent", value: "Make/LeadFactory-Meta-Ads" },
          ],
          qs: [],
          // The body is a JSON-stringified expression that pulls fields from
          // module 1's output. We use Make's `{{1.field}}` IML syntax + a
          // small wrapper that walks `field_data` (an array of {name,values}).
          bodyType: "raw",
          contentType: "application/json",
          // IMPORTANT: Make requires the JSON to be a single string with IML
          // refs inline. The webhook ingest at LeadFactory accepts these top-
          // level fields and also reads field_data[] for any custom answers.
          data: [
            "{",
            "  \"source\": \"calcom\",",
            "  \"meta_lead_id\": \"{{1.id}}\",",
            "  \"external_id\": \"{{1.id}}\",",
            "  \"meta_form_id\": \"{{1.form_id}}\",",
            "  \"meta_form_name\": \"{{1.form_name}}\",",
            "  \"meta_ad_id\": \"{{1.ad_id}}\",",
            "  \"meta_campaign_name\": \"{{1.campaign_name}}\",",
            "  \"full_name\": \"{{1.field_data.full_name}}\",",
            "  \"email\": \"{{1.field_data.email}}\",",
            "  \"phone\": \"{{1.field_data.phone_number}}\",",
            "  \"company\": \"{{1.field_data.company_name}}\",",
            "  \"city\": \"{{1.field_data.city}}\",",
            "  \"field_data\": {{toJSON(1.field_data)}}",
            "}",
          ].join("\n"),
          parseResponse: true,
        },
        metadata: {
          designer: { x: 320, y: 0 },
          restore: {
            expect: {
              method: { label: "POST" },
              headers: { mode: "chose", items: [{}, {}] },
              qs: { mode: "chose" },
              bodyType: { label: "Raw" },
              contentType: { label: "JSON (application/json)" },
            },
          },
          parameters: [
            {
              name: "handleErrors",
              type: "boolean",
              label: "Evaluate all states as errors (except for 2xx and 3xx )",
              required: false,
            },
            {
              name: "useNewZLibDeCompress",
              type: "boolean",
              label: "Use new ZLib DeCompression",
              required: false,
            },
          ],
          expect: [
            { name: "url", type: "url", label: "URL", required: true },
            {
              name: "method",
              type: "select",
              label: "Method",
              required: true,
              validate: { enum: ["get", "post", "put", "patch", "delete"] },
            },
            { name: "headers", type: "array", label: "Headers" },
            {
              name: "bodyType",
              type: "select",
              label: "Body type",
              validate: { enum: ["raw", "x_www_form_urlencoded", "multipart_form_data"] },
            },
            {
              name: "contentType",
              type: "select",
              label: "Content type",
              validate: { enum: ["application/json", "application/xml", "text/plain"] },
            },
            { name: "data", type: "any", label: "Request content" },
            { name: "parseResponse", type: "boolean", label: "Parse response" },
          ],
        },
      },
    ],
    metadata: {
      instant: false,
      version: 1,
      scenario: {
        roundtrips: 1,
        maxErrors: 3,
        autoCommit: true,
        autoCommitTriggerLast: true,
        sequential: false,
        slots: null,
        confidential: false,
        dataloss: false,
        dlq: false,
        freshVariables: false,
      },
      designer: { orphans: [] },
      zone: "eu1.make.com",
      notes: [
        `Generated by LeadFactory on ${new Date().toISOString()} for client ${clientLabel}.`,
        "The HTTP module URL contains the client's webhook key. Do not share this blueprint publicly.",
        "After import: connect your Facebook account, pick the Page + Form, then activate.",
      ],
    },
  };
}
