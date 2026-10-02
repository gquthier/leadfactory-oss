import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { startCodexTurn } from '../src/harness/codex-driver.js';
import { buildClaudeArgs } from '../src/harness/claude-driver.js';

const transport = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('../src/harness/procs.js', async importOriginal => ({
  ...await importOriginal<object>(),
  spawnCli: transport.spawn,
  killCliTree: vi.fn(),
}));

function fakeCodex() {
  const messages: Array<{ method: string; params: any }> = [];
  const child = new EventEmitter() as any;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({ write(bytes, _encoding, done) {
    for (const line of bytes.toString().trim().split('\n')) {
      const message = JSON.parse(line);
      messages.push(message);
      if (message.id !== undefined) queueMicrotask(() => {
        const result = message.method.startsWith('thread/')
          ? { thread: { id: 'native-thread' } }
          : message.method === 'config/read' ? { config: { sandbox_workspace_write: { network_access: true } } } : {};
        child.stdout.write(JSON.stringify({ id: message.id, result }) + '\n');
      });
    }
    done();
  }});
  transport.spawn.mockReturnValue(child);
  return messages;
}

describe('local native CLI capabilities', () => {
  for (const resumed of [false, true]) {
    for (const skip of [false, true]) {
      it(`Codex ${resumed ? 'resumed' : 'new'} turn explicitly ${skip ? 'bypasses' : 'restores'} approvals`, async () => {
        const messages = fakeCodex();
        const handle = startCodexTurn({ cli: '/test/codex', cwd: '/test/workspace', text: 'test', sandbox: 'read-only', skipPermissions: skip, ...(resumed ? { resumeCursor: 'native-thread' } : {}), onEvent: () => {} });
        await vi.waitFor(() => expect(messages.some(m => m.method === 'turn/start')).toBe(true));
        const turn = messages.find(m => m.method === 'turn/start')?.params;
        expect(turn.approvalPolicy).toBe(skip ? 'never' : 'on-request');
        expect(turn.sandboxPolicy.type).toBe(skip ? 'dangerFullAccess' : 'readOnly');
        expect(messages.some(m => m.method === (resumed ? 'thread/resume' : 'thread/start'))).toBe(true);
        handle.stop();
      });
    }
  }
  it('adds BizOS MCP servers without excluding native Claude connectors in bypass mode', () => {
    const args = buildClaudeArgs({ text: 'test', cwd: '/test', sandbox: 'read-only', skipPermissions: true, mcpConfigPath: '/test/mcp.json', system: 'BizOS context', resumeCursor: 'session-1' });
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('bypassPermissions');
    expect(args).toContain('--mcp-config');
    expect(args).not.toContain('--strict-mcp-config');
    expect(args).toContain('--append-system-prompt');
    expect(args).toContain('--resume');
    expect(args).not.toContain('--tools');
  });
  it('keeps configured MCP isolation and normal permissions when bypass is off', () => {
    const args = buildClaudeArgs({ text: 'test', cwd: '/test', additionalDirectories: ['/company', '/company'], sandbox: 'workspace-write', skipPermissions: false, mcpConfigPath: '/test/mcp.json' });
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('acceptEdits');
    expect(args.filter((value) => value === '/company')).toHaveLength(1);
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('bypassPermissions');
  });
});
