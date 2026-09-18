import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalBizosHarness } from '../src/harness/harness.js';
import type { CodexTurnInput, CodexTurnHandle } from '../src/harness/codex-driver.js';
import { buildHandlers, runHandler } from '../src/ipc.js';

const fixtures: Array<{ root: string; harness: LocalBizosHarness }> = [];
function fixture(existingRoot?: string) {
  const root = existingRoot ?? mkdtempSync(join(tmpdir(), 'lbz-quick-chat-'));
  const turns: CodexTurnInput[] = [];
  const responses: unknown[] = [];
  let teamMounts = 0;
  const harness = new LocalBizosHarness({
    rootDir: root, homeDir: root, baseUrl: '', readSessionCookie: async () => '', orgName: () => 'Workspace',
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
  });
  fixtures.push({ root, harness });
  return { root, harness, turns, responses, teamMounts: () => teamMounts };
}
afterEach(async () => { for (const { harness } of fixtures) harness.stop(); for (const root of new Set(fixtures.map(f => f.root))) await rm(root, { recursive: true, force: true }); fixtures.length = 0; });
const done = (turn: CodexTurnInput, text: string) => { turn.onEvent({ type: 'content.delta', streamKind: 'assistant_text', delta: text }); turn.onEvent({ type: 'turn.completed', ok: true, stopReason: null }); };

describe('workspace Quick chats', () => {
  it('shares the bound workspace, isolates histories and native sessions, creates no agents', async () => {
    const f = fixture();
    await f.harness.templates.apply("company-os", "new");
    const roster = await f.harness.bots.list();
    const roots = await f.harness.brain.roots();
    const files = readdirSync(roots[0]!.path);
    const a = await f.harness.quickChats.create('create-a');
    const b = await f.harness.quickChats.create('create-b');
    expect(await f.harness.quickChats.create('create-a')).toEqual(a);
    await f.harness.quickChats.send(a.id, 'Alpha: private conversation A', 'send-a');
    await f.harness.quickChats.send(b.id, 'Beta: private conversation B', 'send-b');
    expect(f.turns).toHaveLength(2);
    expect(f.turns.map(t => t.cwd)).toEqual([roots[0]!.path, roots[0]!.path]);
    expect(f.turns[0]!.system).not.toContain('Beta:');
    expect(f.turns[1]!.system).not.toContain('Alpha:');
    expect(f.turns[0]!.dynamicTools).toEqual([]);
    expect(f.teamMounts()).toBe(0);
    f.turns[0]!.onEvent({ type: 'session.started', sessionId: 'native_0', model: null });
    f.turns[1]!.onEvent({ type: 'session.started', sessionId: 'native_1', model: null });
    done(f.turns[0]!, 'Answer Alpha'); done(f.turns[1]!, 'Answer Beta');
    await f.harness.quickChats.send(a.id, 'Continue A', 'send-a-2');
    expect(f.turns[2]!.system).toContain('Answer Alpha');
    expect(f.turns[2]!.system).not.toContain('Answer Beta');
    expect(f.turns[2]!.resumeCursor).toBe('native_0');
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
    const a = await f.harness.quickChats.create('a'); const b = await f.harness.quickChats.create('b');
    const runA = await f.harness.quickChats.send(a.id, 'Task A', 'a');
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
    expect((await call('send', [chat.id, { requestId: 'x', text: 'x'.repeat(20001) }])).ok).toBe(false);
    expect((await call('get', ['../../somewhere'])).ok).toBe(false);
    expect(f.turns).toHaveLength(0);
    expect(readFileSync(join(f.root, 'quick-chats.json'), 'utf8')).not.toContain('botId');
  });
});
