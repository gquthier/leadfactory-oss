import type { ConversationContinuity } from './continuity-sync.js';
import type { Storage } from './storage.js';

export interface CloudRun {
  runId: string; threadId: string; agentId: string; triggerMessageId: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; error: string | null;
  createdAt: string; updatedAt: string;
}
interface CloudSend { eventId: string; duplicate: boolean; runs: CloudRun[]; }
interface Binding { accountId: string; orgId: string; conversationId: string; installationId: string; }
interface SavedRun { threadId: string; binding: Binding; run: CloudRun; eventId: string; }
interface State {
  selections: Record<string, { destination: 'personal' | 'bizos'; binding: Binding }>;
  requests: Record<string, { threadId: string; content: string; binding: Binding; result?: CloudSend }>;
  runs: Record<string, SavedRun>;
}
const FILE = 'cloud-execution.json';
const active = (run: CloudRun) => run.state === 'queued' || run.state === 'running';
/** Only linked durable DMs use this route. No local files or credentials are
 * copied, and no unsuccessful cloud request falls back to a personal driver. */
export class CloudExecution {
  private state: State;
  constructor(private storage: Storage, private continuity: ConversationContinuity) {
    this.state = storage.readJsonStrict(FILE, { selections: {}, requests: {}, runs: {} });
  }
  private save() { this.storage.writeJson(FILE, this.state); }
  private binding(threadId: string): Binding {
    const link = this.continuity.store.status(threadId);
    if (!/^bot:(?!qchat_)[^:]+$/.test(threadId) || !link)
      throw new Error('BizOS execution requires a linked, durable agent conversation. QuickChat stays ephemeral.');
    return { accountId: link.accountId, orgId: link.orgId, conversationId: link.conversationId, installationId: link.installationId };
  }
  private assertBinding(threadId: string, expected: Binding) {
    if (JSON.stringify(this.binding(threadId)) !== JSON.stringify(expected))
      throw new Error('This execution belongs to another account, installation or conversation.');
  }
  destination(threadId: string): 'personal' | 'bizos' {
    return this.state.selections[threadId]?.destination ?? 'personal';
  }
  async status(threadId: string) {
    const destination = this.destination(threadId);
    try {
      this.binding(threadId);
      const saved = this.state.selections[threadId];
      if (saved) this.assertBinding(threadId, saved.binding);
      const result = await this.continuity.cloud(threadId, 'cloud/status', {}) as { available: boolean; active: boolean; model: string };
      return { destination, ...result };
    } catch (error) {
      return { destination, available: false, reason: error instanceof Error ? error.message : 'BizOS is unavailable.' };
    }
  }
  async select(threadId: string, destination: 'personal' | 'bizos') {
    if (destination === 'personal' && !this.state.selections[threadId]) return { destination, available: false };
    if (Object.values(this.state.requests).some(request => request.threadId === threadId && !request.result))
      throw new Error('Retry the unconfirmed cloud message before changing execution.');
    const status = await this.status(threadId);
    if (!status.available && !(destination === 'personal' && 'active' in status)) throw new Error(status.reason ?? 'BizOS is unavailable.');
    if ('active' in status && status.active) throw new Error('Stop the active run before changing execution.');
    await this.continuity.sync(threadId);
    this.state.selections[threadId] = { destination, binding: this.binding(threadId) };
    this.save();
    return { ...status, destination };
  }
  ownsRun(runId: string): boolean { return Object.hasOwn(this.state.runs, runId); }
  ownsRequest(clientMessageId: string): boolean { return Object.hasOwn(this.state.requests, clientMessageId); }
  async send(threadId: string, clientMessageId: string, content: string): Promise<CloudSend> {
    const saved = this.state.selections[threadId];
    const old = this.state.requests[clientMessageId];
    if (!saved || (saved.destination !== 'bizos' && !old?.result)) throw new Error('BizOS is not selected for this conversation.');
    this.assertBinding(threadId, saved.binding);
    if (old && (old.threadId !== threadId || old.content !== content)) throw new Error('This message id was already used.');
    if (old) this.assertBinding(threadId, old.binding);
    if (saved.destination === 'personal' && old?.result) {
      await this.continuity.sync(threadId);
      return { ...old.result, duplicate: true };
    }
    // Persist the immutable retry identity before the network request. A lost
    // response retries the same server message, never creates a second turn.
    if (!old) {
      this.state.requests[clientMessageId] = { threadId, content, binding: this.binding(threadId) };
      this.save();
    }
    await this.continuity.sync(threadId);
    const result = await this.continuity.cloud(threadId, 'cloud/send', { clientMessageId, content }) as CloudSend;
    this.assertBinding(threadId, saved.binding);
    if (!result.eventId || !Array.isArray(result.runs) || result.runs.some(run => run.threadId !== saved.binding.conversationId))
      throw new Error('BizOS returned a different conversation.');
    this.state.requests[clientMessageId]!.result = result;
    for (const run of result.runs) this.state.runs[`cloud_${run.runId}`] = {
      threadId, binding: saved.binding, run, eventId: result.eventId,
    };
    this.save();
    await this.continuity.sync(threadId);
    return result;
  }
  async run(id: string, stop = false): Promise<SavedRun> {
    const saved = this.state.runs[id];
    if (!saved) throw new Error('Cloud run not found.');
    this.assertBinding(saved.threadId, saved.binding);
    const response = await this.continuity.cloud(saved.threadId, stop ? 'cloud/stop' : 'cloud/run', { runId: saved.run.runId }) as { run: CloudRun };
    if (!response.run || response.run.runId !== saved.run.runId || response.run.threadId !== saved.binding.conversationId)
      throw new Error('BizOS returned a different run.');
    if (stop && active(response.run)) throw new Error('BizOS has not confirmed STOP.');
    saved.run = response.run;
    this.save();
    await this.continuity.sync(saved.threadId);
    return structuredClone(saved);
  }
  runIds(threadId?: string, onlyActive = false): string[] {
    return Object.entries(this.state.runs).filter(([, value]) => (!threadId || value.threadId === threadId) && (!onlyActive || active(value.run))).map(([id]) => id);
  }
}
