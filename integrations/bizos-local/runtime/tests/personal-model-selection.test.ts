import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LocalBizosHarness } from '../src/harness/harness.js';
import { InferenceStore } from '../src/harness/inference.js';
import type { HarnessOptions } from '../src/harness/harness.js';
import { probeInferenceProvider } from '../src/harness/inference.js';
import { asModelSelection } from '../src/ipc.js';
import { Storage } from '../src/harness/storage.js';
import { CollaborationFacade, LocalTeamBroker } from '../src/sidecar.js';
import { emptyDurableIndex } from '../src/sidecar-contract.js';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
function fixture(root = mkdtempSync(join(tmpdir(), 'models40-')), options: Partial<HarnessOptions> = {}) {
  const harness = new LocalBizosHarness({ rootDir: root, homeDir: root, baseUrl: '', readSessionCookie: async () => '', orgName: () => 'Test', execPath: '/missing/node', packaged: false, runAsNodeAvailable: false, mcpScriptPath: '/missing/mcp', devices: false, environment: { PATH: '/nowhere' }, ...options });
  cleanup.push(() => { harness.stop(); rmSync(root, { recursive: true, force: true }); });
  return { harness, root, facade: new CollaborationFacade(harness, 'fixture', new LocalTeamBroker(), emptyDurableIndex(), null, () => {}) };
}
it('retains every valid model in a catalog exceeding 500 through restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog40-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const storage = new Storage(root); const store = new InferenceStore(storage, () => '2026-09-28T00:00:00Z');
  const p = store.add({ kind: 'openrouter', apiKey: 'fixture' });
  const models = Array.from({ length: 650 }, (_, n) => `lab/model-${n}`);
  store.recordTest(p.id, { ok: true, models: [...models, models[0]!] });
  expect(new InferenceStore(storage, () => '').publicList()[0]!.lastTest!.models).toEqual(models);
});
it('allows free personal models and atomically persists QuickChat without changing siblings, workspace, provider or expiry', async () => {
  const f = fixture();
  const p = await f.facade.addInferenceProvider({ kind: 'openrouter', apiKey: 'fixture', model: 'lab/default' }) as {id: string};
  (f.harness as any).inferenceStore.recordTest(p.id, { ok: true, models: ['lab/default', 'lab/selected'] });
  const a = await f.harness.quickChats.create('a'), b = await f.harness.quickChats.create('b');
  const before = await f.harness.runtime.getSettings();
  const selection = { source: 'provider' as const, providerId: p.id, model: 'lab/selected' };
  await f.harness.runtime.selectModel({ scope: { kind: 'quickchat', chatId: a.id }, selection });
  expect((await f.harness.quickChats.get(a.id)).chat).toMatchObject({ modelSelection: selection, expiresAt: a.expiresAt });
  expect((await f.harness.quickChats.get(b.id)).chat).not.toHaveProperty('modelSelection');
  expect(await f.harness.runtime.getSettings()).toEqual(before);
  expect((await f.harness.inference.list()).providers[0]!.model).toBe('lab/default');
  await expect(f.harness.runtime.selectModel({ scope: { kind: 'quickchat', chatId: a.id }, selection: { ...selection, model: 'absent' } })).rejects.toThrow('catalog');
  expect((await f.harness.quickChats.get(a.id)).chat.modelSelection).toEqual(selection);
  f.harness.stop(); const restored = fixture(f.root);
  expect((await restored.harness.quickChats.get(a.id)).chat.modelSelection).toEqual(selection);
});
it('rejects invalid workspace and agent selections before any write', async () => {
  const f = fixture(); const bot = await f.harness.bots.create({ name: 'A' }); const before = await f.harness.runtime.getSettings();
  const selection = { source: 'provider' as const, providerId: 'prv_missing123', model: 'lab/a' };
  await expect(f.harness.runtime.selectModel({ scope: { kind: 'workspace' }, selection })).rejects.toThrow();
  await expect(f.harness.runtime.selectModel({ scope: { kind: 'agent', agentId: bot.id }, selection })).rejects.toThrow();
  expect(await f.harness.runtime.getSettings()).toEqual(before);
  expect((await f.harness.bots.list())[0]).toMatchObject(bot);
});

for (const kind of ['agent', 'quickchat', 'workspace'] as const) it(`dispatches exact Claude/Codex account and API model on free in ${kind} scope`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'drivers40-'));
  const plans = [
    { id: 'pln_codex_one', provider: 'codex', codexHome: join(root, 'codex-one') },
    { id: 'pln_codex_two', provider: 'codex', codexHome: join(root, 'codex-two') },
    { id: 'pln_claude_one', provider: 'claude', configDir: join(root, 'claude-one') },
  ].map(plan => ({ ...plan, label: plan.id, authKind: 'oauth', status: 'connected', priority: 0, createdAt: '2026-09-28T00:00:00Z' }));
  writeFileSync(join(root, 'plans.json'), JSON.stringify({ plans, routing: { pins: {}, defaultPolicy: 'priority' } }));
  const turns: Array<{ driver: string; input: any }> = [];
  const start = (driver: string) => (input: any) => { turns.push({ driver, input }); return { stop: () => {}, respond: () => 'unavailable' as const, sessionId: () => null, settled: () => false }; };
  const f = fixture(root, { environment: { PATH: '/nowhere', LBZ_CODEX_PATH: join(root, 'fake-codex'), LBZ_CLAUDE_PATH: join(root, 'fake-claude') }, startTurn: start('codex'), startClaudeTurn: start('claude'), startOpenAiTurn: start('api') });
  const bot = await f.harness.bots.create({ name: 'Driver test' });
  const chat = await f.harness.quickChats.create('driver-chat');
  const group = await f.harness.groups.create({ name: 'Driver group', memberIds: [bot.id] });
  const scope = kind === 'agent' ? { kind, agentId: bot.id } : kind === 'quickchat' ? { kind, chatId: chat.id } : { kind };
  const provider = await f.harness.inference.add({ kind: 'openrouter', apiKey: 'only-fixture-key', model: 'lab/default' });
  (f.harness as any).inferenceStore.recordTest(provider.id, { ok: true, models: ['lab/default', 'lab/exact'] });
  const cases = [
    { selection: { source: 'plan' as const, planId: 'pln_claude_one', model: 'opus' }, driver: 'claude', env: ['CLAUDE_CONFIG_DIR', join(root, 'claude-one')] },
    { selection: { source: 'plan' as const, planId: 'pln_codex_two', model: 'gpt-5.6-sol' }, driver: 'codex', env: ['CODEX_HOME', join(root, 'codex-two')] },
    { selection: { source: 'provider' as const, providerId: provider.id, model: 'lab/exact' }, driver: 'api' },
  ];
  for (const [n, wanted] of cases.entries()) {
    await f.harness.runtime.selectModel({ scope, selection: wanted.selection });
    const result = kind === 'quickchat' ? await f.harness.quickChats.send(chat.id, 'Synthetic driver test', `send-${n}`) : await f.harness.threads.send(kind === 'agent' ? { botId: bot.id } : { groupId: group.id }, { text: 'Synthetic driver test' });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(turns).toHaveLength(n + 1);
    const last = turns.at(-1)!;
    expect(last.driver).toBe(wanted.driver); expect(last.input.model).toBe(wanted.selection.model);
    if (wanted.env) expect(last.input.environment[wanted.env[0]!]).toBe(wanted.env[1]);
    if (wanted.driver === 'api') expect(last.input.apiKey).toBe('only-fixture-key');
    await expect(f.harness.runtime.selectModel({ scope, selection: wanted.selection })).rejects.toThrow('active run');
    last.input.onEvent({ type: 'turn.completed', ok: true, stopReason: null });
    expect((await f.harness.runs.get(result.runIds[0]!))?.state).toBe('completed');
  }
  expect((await f.harness.inference.list()).providers[0]!.model).toBe('lab/default');
  await f.harness.inference.remove(provider.id);
  const failed = kind === 'quickchat' ? await f.harness.quickChats.send(chat.id, 'Must fail', 'removed') : await f.harness.threads.send(kind === 'agent' ? { botId: bot.id } : { groupId: group.id }, { text: 'Must fail' });
  expect(turns).toHaveLength(3);
  expect((await f.harness.runs.get(failed.runIds[0]!))?.state).toBe('failed');
  await f.harness.runtime.selectModel({ scope, selection: { source: 'plan', planId: 'pln_codex_two', model: 'gpt-5.6-sol' } });
  await f.harness.plans.disconnect('pln_codex_two');
  const noPlan = kind === 'quickchat' ? await f.harness.quickChats.send(chat.id, 'Must fail after plan removal', 'removed-plan') : await f.harness.threads.send(kind === 'agent' ? { botId: bot.id } : { groupId: group.id }, { text: 'Must fail after plan removal' });
  expect(turns).toHaveLength(3);
  expect((await f.harness.runs.get(noPlan.runIds[0]!))?.state).toBe('failed');
});

it('rejects crossed scopes and conflicting source identity at the IPC boundary', () => {
  expect(() => asModelSelection({ scope: { kind: 'workspace', agentId: 'x' }, selection: { source: 'auto', model: '' } })).toThrow();
  expect(() => asModelSelection({ scope: { kind: 'workspace' }, selection: { source: 'provider', providerId: 'prv_fixture123', planId: 'pln_fake', model: 'x' } })).toThrow();
});
it('refreshes 650 models with metadata using only GET /models and refuses oversized responses explicitly', async () => {
  const requested: string[] = [];
  const provider = { kind: 'openrouter' as const, baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture' };
  const result = await probeInferenceProvider(provider, { fetchImpl: async (url, init) => {
    requested.push(String(url)); expect(init?.method ?? 'GET').toBe('GET');
    return new Response(JSON.stringify({ data: Array.from({ length: 650 }, (_, n) => ({ id: `lab/model-${n}`, name: `Model ${n}`, architecture: { output_modalities: ['text'] }, supported_parameters: ['tools'] })) }));
  } });
  expect(requested).toEqual(['https://fixture.invalid/v1/models']); expect(result.models).toHaveLength(650);
  expect(result.apiModelDetails?.at(-1)).toMatchObject({ id: 'lab/model-649', label: 'Model 649', tools: true });
  expect(await probeInferenceProvider(provider, { fetchImpl: async () => new Response('{}', { headers: { 'content-length': String(9 * 1024 * 1024) } }) })).toMatchObject({ ok: false, error: expect.stringContaining('8 MiB') });
});

it('preserves the connector default for legacy workspace profiles with an unrelated CLI model', async () => {
  const calls: string[] = [];
  const f = fixture(undefined, { startOpenAiTurn: input => { calls.push(input.model); return { stop: () => {}, respond: () => 'unavailable', sessionId: () => null, settled: () => false }; } });
  const provider = await f.harness.inference.add({ kind: 'openrouter', apiKey: 'fixture', model: 'lab/legacy-default' });
  await f.harness.runtime.setSettings({ local: { inferenceProviderId: provider.id, model: 'gpt-old-cli-model' } });
  const bot = await f.harness.bots.create({ name: 'Legacy profile' });
  await f.harness.threads.send({ botId: bot.id }, { text: 'Fixture only' });
  expect(calls).toEqual(['lab/legacy-default']);
});
