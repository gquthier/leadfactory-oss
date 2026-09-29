/** Local BizOS model choice. Only the signed Desktop bridge may supply its
 * current organization and workspace; a conversation cloud policy is not an
 * inference credential. The selection is scoped to that signed identity. */
import type { ContinuityTransport } from "../continuity-bridge.js";
import type { Storage } from "./storage.js";

const FILE = "bizos-inference-selection.json";
const MODEL = "bizos-mixture";
type Destination = "personal" | "bizos";
interface Scope { orgId: string; workspaceId: string; userId?: string; installationId?: string }
interface BridgeStatus extends Partial<Scope> { linked?: boolean; toolsAvailable?: boolean }
interface State { selections: Record<string, Scope> }

function thread(id: string): boolean {
  return /^(?:bot:[^:]+|group:[^:]+|chat:qchat_[a-f0-9]{32})$/.test(id);
}
function scopeOf(value: BridgeStatus): Scope | null {
  if (value.linked !== true || value.toolsAvailable !== true || typeof value.orgId !== "string" || !value.orgId || typeof value.workspaceId !== "string" || !value.workspaceId) return null;
  return { orgId: value.orgId, workspaceId: value.workspaceId,
    ...(typeof value.userId === "string" ? { userId: value.userId } : {}),
    ...(typeof value.installationId === "string" ? { installationId: value.installationId } : {}) };
}
function matches(current: Scope, saved: Scope): boolean {
  return current.orgId === saved.orgId && current.workspaceId === saved.workspaceId
    && (!saved.userId || current.userId === saved.userId)
    && (!saved.installationId || current.installationId === saved.installationId);
}

export class BizosInferenceSelection {
  private state: State;
  constructor(private readonly storage: Storage, private readonly bridge?: ContinuityTransport) {
    const loaded = storage.readJsonStrict<State>(FILE, { selections: {} });
    this.state = { selections: loaded.selections ?? {} };
  }
  destination(threadId: string): Destination {
    return Object.hasOwn(this.state.selections, threadId) ? "bizos" : "personal";
  }
  private async current(): Promise<Scope> {
    if (!this.bridge) throw new Error("BizOS inference requires the enrolled Desktop bridge.");
    let reply: BridgeStatus;
    try { reply = await this.bridge<BridgeStatus>("status", {}); }
    catch { throw new Error("BizOS is unavailable. Check this Mac's account connection."); }
    const scope = reply && scopeOf(reply);
    if (!scope) throw new Error("Connect this Mac to a BizOS organization before selecting BizOS.");
    return scope;
  }
  async status(threadId: string) {
    if (!thread(threadId)) throw new Error("Unknown local conversation.");
    const destination = this.destination(threadId);
    try {
      const scope = await this.current();
      if (destination === "bizos" && !matches(scope, this.state.selections[threadId]!))
        return { destination, available: false, model: MODEL, active: false, reason: "BizOS selection belongs to another account or workspace." };
      return { destination, available: true, model: MODEL, active: false, creditCost: 1 };
    } catch (error) {
      return { destination, available: false, model: MODEL, active: false,
        reason: error instanceof Error ? error.message : "BizOS is unavailable." };
    }
  }
  async select(threadId: string, destination: Destination) {
    if (!thread(threadId)) throw new Error("Unknown local conversation.");
    if (destination === "personal") {
      delete this.state.selections[threadId];
      this.storage.writeJson(FILE, this.state);
      return this.status(threadId);
    }
    const scope = await this.current();
    this.state.selections[threadId] = scope;
    this.storage.writeJson(FILE, this.state);
    return this.status(threadId);
  }
  async inherit(sourceThreadId: string, targetThreadIds: string[]): Promise<void> {
    if (!thread(sourceThreadId) || targetThreadIds.some(id => !thread(id)))
      throw new Error("Unknown local conversation.");
    const saved = this.state.selections[sourceThreadId];
    if (!saved) throw new Error("BizOS is not selected for the source conversation.");
    const scope = await this.current();
    if (!matches(scope, saved)) throw new Error("BizOS selection belongs to another account or workspace.");
    for (const id of targetThreadIds) this.state.selections[id] = scope;
    this.storage.writeJson(FILE, this.state);
  }
  async requireSelected(threadId: string): Promise<Scope> {
    const saved = this.state.selections[threadId];
    if (!saved) throw new Error("BizOS is not selected for this conversation.");
    const scope = await this.current();
    if (!matches(scope, saved)) throw new Error("BizOS selection belongs to another account or workspace.");
    return scope;
  }
}
