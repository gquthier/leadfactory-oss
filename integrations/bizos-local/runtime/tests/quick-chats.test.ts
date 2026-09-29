import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CollaborationFacade, LocalTeamBroker } from '../src/sidecar.js';
import { emptyDurableIndex } from '../src/sidecar-contract.js';
import type { LocalStreamFrame } from '../src/local-events.js';
import { LocalBizosHarness, type HarnessOptions } from '../src/harness/harness.js';
import type { CodexTurnInput, CodexTurnHandle } from '../src/harness/codex-driver.js';
import { fixedClock, type Clock } from '../src/harness/clock.js';
import { buildHandlers, runHandler } from '../src/ipc.js';

const fixtures: Array<{ root: string; harness: LocalBizosHarness }> = [];
function fixture(existingRoot?: string, clock?: Clock, readSessionCookie = async () => '', extra: Partial<HarnessOptions> = {}) {
  const root = existingRoot ?? mkdtempSync(join(tmpdir(), 'lbz-quick-chat-'));
  const turns: CodexTurnInput[] = [];
  const responses: unknown[] = [];
  let teamMounts = 0;
  const harness = new LocalBizosHarness({
    rootDir: root, homeDir: root, baseUrl: '', readSessionCookie, clock, orgName: () => 'Workspace',
    execPath: '/fake/node', packaged: false, runAsNodeAvailable: false, mcpScriptPath: '/fake/none.mjs', devices: false,
    environment: { PATH: '/nowhere', LBZ_CODEX_PATH: join(root, 'scripted-codex') },
    localTeamTools: () => { teamMounts++; return []; },
    localTeamMcp: () => { teamMounts++; return { command: '/fake/mcp' }; },
    startTurn: (input): CodexTurnHandle => {
      turns.push(input);
      return {
        stop: () => input.onEvent({ type: 'turn.completed', ok: false, stopReason: 'interrupted' }),
        respond: (id, answer) => { responses.push({ id, answer }); return 'allowed-once'; },
        sessionId: () => `native_${turns.indexOf(input)}`,
        settled: () => false,
      };
    },
    ...extra,
  });
  fixtures.push({ root, harness });
  return { root, harness, turns, responses, teamMounts: () => teamMounts };
}
afterEach(async () => { for (const { harness } of fixtures) harness.stop(); for (const root of new Set(fixtures.map(f => f.root))) await rm(root, { recursive: true, force: true }); fixtures.length = 0; });
const done = (turn: CodexTurnInput, text: string) => { turn.onEvent({ type: 'content.delta', streamKind: 'assistant_text', delta: text }); turn.onEvent({ type: 'turn.completed', ok: true, stopReason: null }); };

describe('workspace Quick chats', () => {
  it('sends signed BizOS image tools to Codex in a QuickChat and requires an observed result', async () => {
    const image = { name: 'bizos_image_generate', description: 'Generate an image', inputSchema: { type: 'object', properties: {} }, call: async () => ({ imageId: 'image-1' }) };
    const f = fixture(undefined, undefined, async () => '', {
      localTeamTools: () => [image],
      localTeamMcp: () => ({ command: '/fake/mcp', args: ['--toolset=bizos'] }),
    });
    const chat = await f.harness.quickChats.create('signed-image');
    await f.harness.quickChats.send(chat.id, 'Generate an image', 'image-request');
    const turn = f.turns[0]!;
    expect(turn.dynamicTools?.map(tool => tool.name)).toContain('bizos_image_generate');
    expect(turn.dynamicTools?.map(tool => tool.name)).not.toContain('recruit_agent');
    expect(turn.system).toContain('bizos_image_generate');
    expect(turn.system).toMatch(/Never announce.*image.*without.*tool/i);
  });
  it('replays long archived constraints after more than one UI page and a fresh CLI session', async () => {
    const f = fixture();
    await f.harness.templates.apply('company-os', 'new');
    const chat = await f.harness.quickChats.create('archive');
    const constraint = `QUICK_ARCHIVE_BEGIN ${'Keep the precise original requirement. '.repeat(52)} QUICK_ARCHIVE_END`;
    expect(constraint.length).toBeGreaterThan(1200);
    await f.harness.quickChats.send(chat.id, constraint, 'archive-first');
    done(f.turns[0]!, 'Understood');
    for (let index = 0; index < 32; index++) {
      await f.harness.quickChats.send(chat.id, `Progress ${index}`, `archive-${index}`);
      done(f.turns[index + 1]!, `Answer ${index}`);
    }
    const latest = `Continue in the new session. ${'Preserve every detail in this new request. '.repeat(45)}`.trim();
    await f.harness.quickChats.send(chat.id, latest, 'archive-last');
    const switched = f.turns.at(-1)!;
    expect(switched.resumeCursor).toBeNull();
    expect(switched.system).toContain(constraint);
    expect(switched.system).toContain('Progress 0');
    expect(switched.system).toContain('Answer 31');
    expect(switched.text).toBe(latest);
  }, 20_000);

  it('shares the bound workspace, isolates histories and native sessions, creates no agents', async () => {
    const f = fixture();
    await f.harness.templates.apply("company-os", "new");
    const roster = await f.harness.bots.list();
    const roots = await f.harness.brain.roots();
    const files = readdirSync(roots[0]!.path);
    const a = await f.harness.quickChats.create('create-a');
    await f.harness.quickChats.send(a.id, 'Alpha: private conversation A', 'send-a');
    const b = await f.harness.quickChats.create('create-b');
    expect(b.id).not.toBe(a.id);
    expect(await f.harness.quickChats.create('create-a')).toEqual(await f.harness.quickChats.get(a.id).then(row => row.chat));
    await f.harness.quickChats.send(b.id, 'Beta: private conversation B', 'send-b');
    expect(f.turns).toHaveLength(2);
    expect(f.turns.map(t => t.cwd)).toEqual([roots[0]!.path, roots[0]!.path]);
    expect(f.turns[0]!.system).not.toContain('Beta:');
    expect(f.turns[1]!.system).not.toContain('Alpha:');
    expect(f.turns[0]!.dynamicTools).toEqual([]);
    expect(f.teamMounts()).toBeGreaterThan(0);
    f.turns[0]!.onEvent({ type: 'session.started', sessionId: 'native_0', model: null });
    f.turns[1]!.onEvent({ type: 'session.started', sessionId: 'native_1', model: null });
    done(f.turns[0]!, 'Answer Alpha'); done(f.turns[1]!, 'Answer Beta');
    await f.harness.quickChats.send(a.id, 'Continue A', 'send-a-2');
    expect(f.turns[2]!.system).toContain('Answer Alpha');
    expect(f.turns[2]!.system).not.toContain('Answer Beta');
    expect(f.turns[2]!.resumeCursor).toBeNull();
    expect('tee' in f.turns[2]!).toBe(false);
    expect(await f.harness.bots.list()).toEqual(roster);
    expect(readdirSync(roots[0]!.path)).toEqual(files);
    expect(existsSync(join(f.root, 'workspaces', a.id))).toBe(false);
    expect((await f.harness.quickChats.get(a.id)).messages.some(m => m.blocks.some(block => block.kind === 'text' && block.text.includes('Beta')))).toBe(false);
  });

  it('deduplicates concurrent sends, rejects conflicting retries, and persists across restart', async () => {
    const f = fixture(); await f.harness.templates.apply("company-os", "new");
    const chat = await f.harness.quickChats.create('create');
    const results = await Promise.all([f.harness.quickChats.send(chat.id, 'Hello', 'request'), f.harness.quickChats.send(chat.id, 'Hello', 'request')]);
    expect(f.turns).toHaveLength(1);
    expect(results.filter(row => row.replayed)).toHaveLength(1);
    await expect(f.harness.quickChats.send(chat.id, 'Different', 'request')).rejects.toThrow('different message');
    done(f.turns[0]!, 'Persisted answer'); f.harness.stop();
    const restored = fixture(f.root);
    expect((await restored.harness.quickChats.list()).chats).toHaveLength(1);
    expect(JSON.stringify(await restored.harness.quickChats.get(chat.id))).toContain('Persisted answer');
    await restored.harness.quickChats.send(chat.id, 'Hello', 'request');
    expect(restored.turns).toHaveLength(0);
    const other = fixture(); await other.harness.templates.apply("company-os", "new");
    await expect(other.harness.quickChats.get(chat.id)).rejects.toThrow('workspace');
  });

  it('scopes STOP and approvals to their chat and preserves failure evidence', async () => {
    const f = fixture(); await f.harness.templates.apply("company-os", "new");
    const a = await f.harness.quickChats.create('a');
    const runA = await f.harness.quickChats.send(a.id, 'Task A', 'a');
    const b = await f.harness.quickChats.create('b');
    const runB = await f.harness.quickChats.send(b.id, 'Task B', 'b');
    f.turns[0]!.onEvent({ type: 'request.opened', requestId: 'approval-a', requestType: 'permission', tool: 'shell', summary: 'Allow command?', detail: 'touch result.txt' });
    const block = (await f.harness.quickChats.get(a.id)).messages.flatMap(m => m.blocks).find(block => block.kind === 'ask');
    expect(block?.kind).toBe('ask');
    if (block?.kind !== 'ask') throw new Error('Missing permission request');
    await expect(f.harness.quickChats.answer(b.id, { runId: runA.runIds[0]!, askId: block.askId, answer: { kind: 'allow_once' } })).rejects.toThrow('belong');
    await f.harness.quickChats.answer(a.id, { runId: runA.runIds[0]!, askId: block.askId, answer: { kind: 'allow_once' } });
    expect(f.responses).toHaveLength(1);
    await f.harness.quickChats.stop(a.id);
    expect((await f.harness.quickChats.get(a.id)).activeRunIds).toHaveLength(0);
    expect((await f.harness.quickChats.get(b.id)).activeRunIds).toEqual(runB.runIds);
    f.turns[1]!.onEvent({ type: 'runtime.error', message: 'Provider unavailable' });
    f.turns[1]!.onEvent({ type: 'turn.completed', ok: false, stopReason: 'failed' });
    expect((await f.harness.quickChats.get(b.id)).runs[0]?.state).toBe('failed');
    expect(JSON.stringify(await f.harness.quickChats.get(b.id))).toContain('Provider unavailable');
  });

  it('validates the boundary and opens an empty workspace without creating bots', async () => {
    const f = fixture();
    await f.harness.quickChats.create('new');
    expect(await f.harness.bots.list()).toEqual([]);
    expect(existsSync(join(f.root, 'workspaces', 'shared'))).toBe(true);
    const handlers = buildHandlers(f.harness);
    const call = (action: string, args: unknown[]) => runHandler(handlers[`lbz:quickChats:${action}`]!, args);
    expect((await call('create', [{ requestId: 'x', botId: 'injected' }])).ok).toBe(false);
    const chat = await f.harness.quickChats.create('valid');
    expect((await call('send', [chat.id, { requestId: 'x', text: '', workspacePath: '/tmp' }])).ok).toBe(false);
    expect((await call('send', [chat.id, { requestId: 'x', text: 'é'.repeat(16 * 1024 * 1024 + 1) }])).ok).toBe(false);
    expect((await call('get', ['../../somewhere'])).ok).toBe(false);
    expect(f.turns).toHaveLength(0);
    expect(readFileSync(join(f.root, 'quick-chats.json'), 'utf8')).not.toContain('botId');
  });
});

const DAY = 24 * 60 * 60 * 1000;
const epoch = Date.parse('2026-09-26T00:00:00Z');
describe('QuickChat expiry', () => {
  it('keeps the exact name and expires an empty chat at 24h, including create retries', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    const chat = await f.harness.quickChats.create('empty');
    expect(chat.title).toBe('QuickChat');
    clock.advance(DAY - 1);
    expect((await f.harness.quickChats.get(chat.id)).chat.title).toBe('QuickChat');
    clock.advance(1);
    expect((await f.harness.quickChats.list()).chats).toEqual([]);
    await expect(f.harness.quickChats.get(chat.id)).rejects.toThrow();
    await expect(f.harness.quickChats.create('empty')).rejects.toThrow();
  });

  it('counts user and assistant text, not reads, system lines or control activity', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    const chat = await f.harness.quickChats.create('activity');
    await f.harness.quickChats.send(chat.id, 'First request', 'first');
    clock.advance(12 * 60 * 60 * 1000);
    done(f.turns[0]!, 'Assistant answer at noon');
    clock.advance(13 * 60 * 60 * 1000);
    expect((await f.harness.quickChats.get(chat.id)).chat.title).toBe('QuickChat');
    await f.harness.quickChats.send(chat.id, 'Second request', 'second');
    const lastMessageAt = clock.nowIso();
    clock.advance(DAY - 1);
    await f.harness.quickChats.messages(chat.id);
    await f.harness.threads.markRead({ chatId: chat.id });
    await f.harness.threads.send({ chatId: chat.id }, { role: 'system', text: 'System refresh' });
    f.turns[1]!.onEvent({ type: 'item.started', title: 'Read', itemId: 'control' });
    expect((await f.harness.quickChats.get(chat.id)).chat.updatedAt).toBe(lastMessageAt);
    clock.advance(1);
    expect((await f.harness.quickChats.list()).chats).toEqual([]);
  });

  it('purges persistent chat state, stops active turns and rejects late callbacks without touching siblings or business files', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    const a = await f.harness.quickChats.create('purge');
    await f.harness.quickChats.send(a.id, 'Secret request', 'purge-send');
    const oldTurn = f.turns[0]!;
    oldTurn.onEvent({ type: 'session.started', sessionId: 'private-session', model: null });
    oldTurn.tee?.({ dir: 'in', msg: 'private-native' });
    const bot = await f.harness.bots.create({ name: 'Keep agent' });
    await f.harness.threads.send({ botId: bot.id }, { text: 'Keep bot conversation' });
    const business = join(f.root, 'workspaces', 'shared', 'keep.md');
    writeFileSync(business, 'Business deliverable');
    clock.advance(DAY - 1);
    const b = await f.harness.quickChats.create('sibling');
    clock.advance(1);
    oldTurn.onEvent({ type: 'session.started', sessionId: 'resurrected', model: null });
    done(oldTurn, 'Late private answer');
    oldTurn.tee?.({ dir: 'in', msg: 'late-native' });
    expect(existsSync(join(f.root, 'threads', `chat-${a.id}.ndjson`))).toBe(false);
    expect(existsSync(join(f.root, 'native', `chat-${a.id}.ndjson`))).toBe(false);
    expect(readFileSync(join(f.root, 'cursors.json'), 'utf8')).not.toContain(a.id);
    expect(readFileSync(join(f.root, 'runs.json'), 'utf8')).not.toContain(a.id);
    expect(readFileSync(business, 'utf8')).toBe('Business deliverable');
    expect((await f.harness.quickChats.list()).chats.map(c => c.id)).toEqual([b.id]);
    expect(JSON.stringify(await f.harness.threads.get({ botId: bot.id }))).toContain('Keep bot conversation');
    await expect(f.harness.threads.send({ chatId: a.id }, { text: 'Resurrect' })).rejects.toThrow();
    await expect(f.harness.threads.get({ chatId: a.id })).rejects.toThrow();
  });

  it('removes a legacy continuity mapping on expiry without recovering its archive or affecting a linked bot', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    const other = fixture(undefined, fixedClock(epoch));
    const otherChat = await other.harness.quickChats.create('legacy-linked');
    const chat = await f.harness.quickChats.create('legacy-linked');
    await f.harness.quickChats.send(chat.id, 'Ephemeral secret', 'legacy-linked-send');
    const threadId = `chat:${chat.id}`;
    f.harness.continuity.store.link(threadId, { conversationId: 'legacy-cloud-chat', installationId: 'device', accountId: 'owner', orgId: 'org' });
    f.harness.continuity.store.capture({ id: 'legacy-event', threadId, seq: 2, role: 'user', blocks: [{ kind: 'text', text: 'Legacy archive secret' }], createdAt: clock.nowIso() });
    f.harness.continuity.store.queue('legacy-queued', { runId: 'legacy-queued', threadId, text: 'Legacy queued secret' });
    f.harness.continuity.store.link('bot:keep', { conversationId: 'bot-cloud-chat', installationId: 'device', accountId: 'owner', orgId: 'org' });
    f.harness.continuity.store.capture({ id: 'bot-event', threadId: 'bot:keep', seq: 1, role: 'user', blocks: [{ kind: 'text', text: 'Persistent bot message' }], createdAt: clock.nowIso() });
    f.harness.stop();
    clock.advance(DAY);
    const calls: string[] = [];
    const restored = fixture(f.root, clock, async () => '', { continuityTransport: async operation => { calls.push(operation); throw new Error('No fixture bridge'); } });
    expect((await restored.harness.quickChats.list()).chats).toEqual([]);
    expect(restored.harness.continuity.store.status(threadId)).toBeNull();
    expect(restored.harness.continuity.projection(threadId)).toEqual([]);
    expect(restored.harness.continuity.store.status('bot:keep')?.conversationId).toBe('bot-cloud-chat');
    expect(restored.harness.continuity.store.pending('bot:keep')).toHaveLength(1);
    await restored.harness.continuity.sync(threadId);
    expect(calls).toEqual([]);
    expect(readFileSync(join(f.root, 'continuity.json'), 'utf8')).not.toContain('Legacy archive secret');
    expect(readFileSync(join(f.root, 'continuity.json'), 'utf8')).not.toContain('Legacy queued secret');
    expect(readFileSync(join(f.root, 'continuity.json'), 'utf8')).toContain('Persistent bot message');
    expect(existsSync(join(f.root, 'threads', `chat-${chat.id}.ndjson`))).toBe(false);
    expect((await other.harness.quickChats.list()).chats.map(row => row.id)).toEqual([otherChat.id]);
  });

  it('detaches a legacy QuickChat mapping during an in-process expiry', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    const chat = await f.harness.quickChats.create('live-legacy-link');
    const threadId = `chat:${chat.id}`;
    f.harness.continuity.store.link(threadId, { conversationId: 'legacy-live', installationId: 'device', accountId: 'owner', orgId: 'org' });
    clock.advance(DAY);
    expect(f.harness.continuity.store.status(threadId)).toBeNull();
    expect(f.harness.continuity.projection(threadId)).toEqual([]);
    expect((await f.harness.quickChats.list()).chats).toEqual([]);
  });

  it('recovers legacy assistant activity and titles, then expires after restart with no timer or reads', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    const chat = await f.harness.quickChats.create('legacy');
    await f.harness.quickChats.send(chat.id, 'Old request', 'legacy-send');
    clock.advance(12 * 60 * 60 * 1000);
    done(f.turns[0]!, 'Recent assistant');
    f.harness.stop();
    // Legacy rows had no activity field, and updatedAt only recorded sends.
    writeFileSync(join(f.root, 'quick-chats.json'), JSON.stringify([{ ...chat, title: 'Old auto title' }]));
    const log = join(f.root, 'threads', `chat-${chat.id}.ndjson`);
    clock.advance(13 * 60 * 60 * 1000);
    const restored = fixture(f.root, clock);
    expect((await restored.harness.quickChats.get(chat.id)).chat.title).toBe('QuickChat');
    restored.harness.stop();
    clock.advance(11 * 60 * 60 * 1000);
    const expired = fixture(f.root, clock);
    expect((await expired.harness.quickChats.list()).chats).toEqual([]);
    expect(existsSync(log)).toBe(false);
  });

  it('rechecks expiry after an awaited send and while timers were suspended by sleep', async () => {
    let now = epoch;
    const clock: Clock = { now: () => new Date(now), nowIso: () => new Date(now).toISOString(), setTimeout: () => () => {} };
    let resume = () => {};
    let reached = () => {};
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const f = fixture(undefined, clock, () => new Promise<string>(resolve => { resume = () => resolve(''); reached(); }));
    const chat = await f.harness.quickChats.create('race');
    const sending = f.harness.quickChats.send(chat.id, 'Too late', 'race-send');
    await entered; now += DAY; resume();
    await expect(sending).rejects.toThrow();
    expect(f.turns).toHaveLength(0);
    expect((await f.harness.quickChats.list()).chats).toEqual([]);
  });
});


describe('QuickChat durable deletion projection', () => {
  it('erases content-bearing idempotency records and emits a deletion hint; restart replays cleanup', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    const index = emptyDurableIndex();
    const indexPath = join(f.root, 'collaboration-index.json');
    const persist = () => writeFileSync(indexPath, JSON.stringify(index));
    const facade = new CollaborationFacade(f.harness, 'fixture', new LocalTeamBroker(), index, null, persist);
    const frames: LocalStreamFrame[] = [];
    facade.streams.subscribe(frame => frames.push(frame));
    const chat = await f.harness.quickChats.create('sidecar');
    // Use the exact public thread id from the real facade.
    const publicId = (await facade.bootstrap()).threads.find(t => t.kind === 'chat')!.id;
    await facade.postMessage(publicId, { clientMessageId: '11111111-1111-4111-8111-111111111111', content: 'Private index content' });
    done(f.turns[0]!, 'Private response');
    expect(readFileSync(indexPath, 'utf8')).toContain('Private index content');
    const priorIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
    clock.advance(DAY);
    expect(frames).toContainEqual({ event: 'thread', data: { threadId: publicId, change: 'deleted', reason: 'expired' } });
    expect((await facade.bootstrap()).threads.some(t => t.id === publicId)).toBe(false);
    expect(index.messages).toEqual({}); expect(index.runTriggers).toEqual({});
    expect(readFileSync(indexPath, 'utf8')).not.toContain('Private index content');
    f.harness.stop();
    const restored = fixture(f.root, clock);
    let repaired = false;
    new CollaborationFacade(restored.harness, 'fixture', new LocalTeamBroker(), priorIndex, null, () => { repaired = true; });
    expect(repaired).toBe(true); expect(priorIndex.messages).toEqual({}); expect(priorIndex.runTriggers).toEqual({});
  });

  it('revokes first and retries a failed unlink durably after restart', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    const chat = await f.harness.quickChats.create('failed-unlink');
    await f.harness.quickChats.send(chat.id, 'Written, so a sibling is a new chat', 'written');
    done(f.turns[0]!, 'Noted');
    const logPath = join(f.root, 'threads', `chat-${chat.id}.ndjson`);
    rmSync(logPath, { recursive: true, force: true });
    mkdirSync(logPath);
    const events: string[] = [];
    f.harness.events.subscribe(event => events.push(event.type));
    clock.advance(DAY - 1);
    const sibling = await f.harness.quickChats.create('available');
    clock.advance(1);
    expect(events).toContain('quick-chat.expired');
    expect((await f.harness.quickChats.list()).chats.map(c => c.id)).toEqual([sibling.id]);
    expect(readFileSync(join(f.root, 'expired-quick-chats.json'), 'utf8')).toContain(chat.id);
    expect(readFileSync(join(f.root, 'quick-chats.json'), 'utf8')).not.toContain(chat.id);
    await expect(f.harness.quickChats.send(chat.id, 'Must not restart', 'retry')).rejects.toThrow();
    f.harness.stop();
    const restored = fixture(f.root, clock); // Still blocked by the directory; workspace opens.
    expect((await restored.harness.quickChats.list()).chats.map(c => c.id)).toEqual([sibling.id]);
    rmSync(logPath, { recursive: true });
    writeFileSync(logPath, 'old private data left after a crash\n');
    clock.advance(60_000); // Retry timer works without a read.
    expect((await restored.harness.quickChats.list()).chats.map(c => c.id)).toEqual([sibling.id]);
    expect(existsSync(logPath)).toBe(false);
    await expect(restored.harness.quickChats.create('failed-unlink')).rejects.toThrow();
  });
});


describe('QuickChat production conversation boundaries', () => {
  it('counts published assistant messages but not hidden deltas, controls, duplicate completion or turn completion', async () => {
    const clock = fixedClock(epoch);
    const f = fixture(undefined, clock, undefined, { localArchitecture: input => ({
      mode: 'local', instanceId: 'fixture', workspaceId: 'workspace', agentId: 'unused', threadId: input.threadId,
      workspaceDir: input.workspaceDir, sandbox: input.sandbox, supportedProviders: ['codex'], peers: [], recruitment: 'unavailable',
    }) });
    const chat = await f.harness.quickChats.create('public');
    await f.harness.quickChats.send(chat.id, 'Question', 'public-send');
    clock.advance(12 * 60 * 60 * 1000);
    const turn = f.turns[0]!;
    turn.onEvent({ type: 'item.completed', itemType: 'assistant_text', itemId: 'answer', text: 'Published answer', phase: 'final_answer' });
    const at = clock.nowIso();
    clock.advance(13 * 60 * 60 * 1000);
    turn.onEvent({ type: 'content.delta', streamKind: 'assistant_text', delta: 'Hidden unfinished text' });
    turn.onEvent({ type: 'item.started', title: 'Read', itemId: 'tool' });
    turn.onEvent({ type: 'item.completed', itemType: 'assistant_text', itemId: 'answer', text: 'Published answer', phase: 'final_answer' });
    turn.onEvent({ type: 'turn.completed', ok: true, stopReason: null });
    expect((await f.harness.quickChats.get(chat.id)).chat.updatedAt).toBe(at);
    clock.advance(11 * 60 * 60 * 1000);
    expect((await f.harness.quickChats.list()).chats).toEqual([]);
    turn.tee?.({ dir: 'in', msg: 'late tee from finished turn' });
    expect(existsSync(join(f.root, 'native', `chat-${chat.id}.ndjson`))).toBe(false);
  });

  it('purges only the expired chat’s persisted approvals, pins and native cursors at restart', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    const chat = await f.harness.quickChats.create('metadata');
    f.harness.stop();
    const key = `chat:${chat.id}|${chat.id}`; const other = 'bot:keep|keep';
    writeFileSync(join(f.root, 'cursors.json'), JSON.stringify({ [key]: 'private-session', [`${key}|brief`]: 'private-brief', [other]: 'keep-session' }));
    writeFileSync(join(f.root, 'approvals.json'), JSON.stringify({ [`${chat.id}|permission|test`]: true, 'keep|permission|test': true }));
    writeFileSync(join(f.root, 'plans.json'), JSON.stringify({ plans: [], routing: { pins: { [key]: 'plan', [other]: 'plan' } } }));
    clock.advance(DAY);
    const restored = fixture(f.root, clock);
    expect((await restored.harness.quickChats.list()).chats).toEqual([]);
    expect(JSON.parse(readFileSync(join(f.root, 'cursors.json'), 'utf8'))).toEqual({ [other]: 'keep-session' });
    expect(JSON.parse(readFileSync(join(f.root, 'approvals.json'), 'utf8'))).toEqual({ 'keep|permission|test': true });
    expect(JSON.parse(readFileSync(join(f.root, 'plans.json'), 'utf8')).routing.pins).toEqual({ [other]: 'plan' });
  });

  it('reuses the newest empty QuickChat for a new intention until someone writes in it (UX-02)', async () => {
    const f = fixture(); await f.harness.templates.apply('company-os', 'new');
    const first = await f.harness.quickChats.create('intent-1');
    const again = await f.harness.quickChats.create('intent-2');
    expect(again.id).toBe(first.id);
    expect((await f.harness.quickChats.list()).chats).toHaveLength(1);
    await f.harness.quickChats.send(first.id, 'Now it has content', 'send-1');
    const second = await f.harness.quickChats.create('intent-3');
    expect(second.id).not.toBe(first.id);
    expect((await f.harness.quickChats.list()).chats.map(row => row.id).sort()).toEqual([first.id, second.id].sort());
    // The original intention still maps to its own chat.
    expect((await f.harness.quickChats.create('intent-1')).id).toBe(first.id);
  });

  it('purges older empty duplicates at startup and keeps the newest one and every written chat (UX-02)', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    await f.harness.templates.apply('company-os', 'new');
    const written = await f.harness.quickChats.create('written');
    await f.harness.quickChats.send(written.id, 'Keep me', 'keep');
    done(f.turns[0]!, 'Kept');
    f.harness.stop();
    // Three blank chats left behind by an older build that created one per click.
    const file = join(f.root, 'quick-chats.json');
    const rows = JSON.parse(readFileSync(file, 'utf8')) as Array<Record<string, unknown>>;
    const blank = (n: number) => {
      const createdAt = new Date(epoch - (4 - n) * 60_000).toISOString();
      return { id: `qchat_${String(n).repeat(32)}`, title: 'QuickChat', createdAt, updatedAt: createdAt, expiresAt: new Date(epoch - (4 - n) * 60_000 + DAY).toISOString() };
    };
    writeFileSync(file, JSON.stringify([...rows, blank(1), blank(2), blank(3)]));
    const restored = fixture(f.root, clock);
    const ids = (await restored.harness.quickChats.list()).chats.map(row => row.id).sort();
    expect(ids).toEqual([written.id, blank(3).id].sort());
    expect(JSON.parse(readFileSync(join(f.root, 'expired-quick-chats.json'), 'utf8')).sort()).toEqual([blank(1).id, blank(2).id].sort());
    await expect(restored.harness.quickChats.get(blank(1).id)).rejects.toThrow('expired');
  });

  it('omits a chat expiring during async bootstrap without failing the workspace', async () => {
    const clock = fixedClock(epoch); const f = fixture(undefined, clock);
    await f.harness.quickChats.create('bootstrap-race');
    const facade = new CollaborationFacade(f.harness, 'fixture', new LocalTeamBroker(), emptyDurableIndex(), null, () => {});
    const bootstrap = facade.bootstrap();
    clock.advance(DAY);
    expect((await bootstrap).threads).toEqual([]);
  });
});
