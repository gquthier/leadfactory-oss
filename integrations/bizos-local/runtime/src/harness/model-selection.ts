/** Personal inference only; cloud admission has its own authenticated contract. */
export type PersonalModelSelection =
  | { source: "auto"; model: string }
  | { source: "plan"; planId: string; model: string }
  | { source: "provider"; providerId: string; model: string };
export type ModelSelectionScope = { kind: "workspace" } | { kind: "agent"; agentId: string } | { kind: "quickchat"; chatId: string };
export interface ModelSelectionInput { scope: ModelSelectionScope; selection: PersonalModelSelection }
export function selectionBotFields(selection: PersonalModelSelection) {
  return { model: selection.model, planId: selection.source === "plan" ? selection.planId : "", providerId: selection.source === "provider" ? selection.providerId : "" };
}

export function isPersonalModelSelection(value: unknown): value is PersonalModelSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.model !== "string" || row.model.length > 120 || (row.model !== "" && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(row.model))) return false;
  if (row.source === "auto") return row.planId === undefined && row.providerId === undefined;
  if (row.source === "plan") return typeof row.planId === "string" && /^pln_[A-Za-z0-9_-]+$/.test(row.planId) && row.providerId === undefined;
  return row.source === "provider" && typeof row.providerId === "string" && /^prv_[A-Za-z0-9]+$/.test(row.providerId) && row.planId === undefined;
}
