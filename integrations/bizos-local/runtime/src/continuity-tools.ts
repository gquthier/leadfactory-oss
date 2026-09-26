/** Provider-neutral schema; the payload is explicit text, never a disk path. */
export const PUBLISH_CONVERSATION_ARTIFACT = {
  name: "publish_conversation_artifact",
  description:
    "Explicitly share or update an authorized conversation text document for another installation or cloud continuation. UTF-8 text is limited to 128 KiB. New documents use version 1 and previousHash null; updates require artifactId, the next version and the latest sha256. Returns a verified version and checkpoint. This never reads arbitrary files or uploads a folder.",
  inputSchema: {
    type: "object",
    properties: {
      artifactId: { type: "string", format: "uuid" },
      name: { type: "string", minLength: 1, maxLength: 200 },
      mimeType: {
        type: "string",
        enum: ["text/plain", "text/markdown", "text/csv", "application/json"],
      },
      text: { type: "string", maxLength: 131072 },
      version: { type: "integer", minimum: 1 },
      previousHash: {
        type: ["string", "null"],
        description: "Latest version SHA256; null for a new document.",
      },
    },
    required: ["name", "mimeType", "text", "version", "previousHash"],
    additionalProperties: false,
  },
};

export const READ_CONVERSATION_ARTIFACT = {
  name: "read_conversation_artifact",
  description:
    "Read a verified page of an explicitly shared UTF-8 conversation document. Offsets count Unicode characters; next is null at the end. The full version hash is checked before every page. Continue from next to read all text.",
  inputSchema: {
    type: "object",
    properties: {
      artifactId: { type: "string" },
      version: { type: "integer", minimum: 1 },
      offset: { type: "integer", minimum: 0, default: 0 },
      limit: { type: "integer", minimum: 1, maximum: 6000, default: 6000 },
    },
    required: ["artifactId", "version"],
    additionalProperties: false,
  },
};

export const CONTINUITY_MCP_OPERATIONS: Record<string, string> = {
  computers: "list_accessible_computers",
  archive: "read_conversation_archive",
  artifact: READ_CONVERSATION_ARTIFACT.name,
  "publish-artifact": PUBLISH_CONVERSATION_ARTIFACT.name,
};
