import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const runtime = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(runtime, 'dist/sidecar.js');
const built = existsSync(script) && existsSync(join(runtime, 'dist/agency-kit/lib/app.mjs'));
let root: string, child: ChildProcess, server: Server, descriptor: {origin: string; token: string}, providerOrigin: string;
const requests: string[] = [];
async function api(method: string, path: string, body?: unknown, token = descriptor.token) {
  const result = await fetch(new URL(path, descriptor.origin), {method, headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {status: result.status, body: await result.json() as any};
}
describe.skipIf(!built)('personal model selection authenticated HTTP contract', () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'models40-http-')); mkdirSync(join(root, 'home'));
    server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      res.setHeader('content-type', 'application/json');
      if (req.method !== 'GET' || req.url !== '/v1/models') { res.statusCode = 500; res.end('{}'); return; }
      res.end(JSON.stringify({data: Array.from({length: 650}, (_, n) => ({id: `lab/model-${n}`, name: `Model ${n}`, architecture: {output_modalities: ['text']}, supported_parameters: ['tools']}))}));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    providerOrigin = `http://127.0.0.1:${(server.address() as {port: number}).port}/v1`;
    const descriptorPath = join(root, 'descriptor.json');
    child = spawn(process.execPath, [script, 'serve'], {cwd: runtime, env: { HOME: join(root, 'home'), PATH: '/usr/bin:/bin', TMPDIR: root, LOCALBIZOS_SIDECAR_STATE: join(root, 'state'), LOCALBIZOS_SIDECAR_DESCRIPTOR: descriptorPath }, stdio: 'ignore'});
    for (let n = 0; n < 200; n++) {
      try { descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')); if ((await api('GET', '/api/local/health')).status === 200) return; } catch { }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('sidecar did not become ready');
  }, 30_000);
  afterAll(async () => {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (root) rmSync(root, {recursive: true, force: true});
  });
  it('keeps authorization, refreshes the full catalog, and applies exact source/model to only the requested scope on free', async () => {
    const path = '/api/local/model-selection';
    expect((await api('POST', path, {}, 'invalid')).status).toBe(401);
    expect((await api('GET', '/api/local/entitlement')).body.tier).toBe('free');
    const created = await api('POST', '/api/local/providers', {kind: 'openai-compatible', baseUrl: providerOrigin, apiKey: 'fixture-only', model: 'lab/model-0'});
    expect(created.status).toBe(201); const id = created.body.provider.id;
    const catalog = await api('POST', `/api/local/providers/${id}/test`, {});
    expect(catalog.body.models).toHaveLength(650);
    expect(JSON.stringify(catalog.body)).not.toContain('fixture-only');
    const chat = await api('POST', '/api/local/quick-chats', {requestId: 'scope-http'});
    const chatId = chat.body.id;
    expect(chatId).toMatch(/^qchat_/);
    const before = await api('GET', '/api/local/runtime');
    const selection = {source: 'provider', providerId: id, model: 'lab/model-649'};
    expect(await api('POST', path, {scope: {kind: 'quickchat', chatId}, selection})).toMatchObject({status: 200, body: {selection}});
    expect((await api('GET', `/api/local/quick-chats/${chatId}`)).body.chat).toMatchObject({modelSelection: selection, expiresAt: chat.body.expiresAt});
    expect((await api('GET', '/api/local/runtime')).body.settings.local).toEqual(before.body.settings.local);
    expect((await api('POST', path, {scope: {kind: 'workspace'}, selection})).status).toBe(200);
    const selected = (await api('GET', '/api/local/runtime')).body;
    expect(selected.settings.local).toMatchObject({model: 'lab/model-649', inferenceProviderId: id});
    expect(selected.inference.external.find((p: any) => p.id === id).model).toBe('lab/model-0');
    expect((await api('POST', path, {scope: {kind: 'workspace'}, selection: {source: 'auto', model: selection.model}})).status).toBe(400);
    expect((await api('POST', path, {scope: {kind: 'workspace'}, selection: {...selection, model: 'not-in-catalog'}})).status).toBe(400);
    expect((await api('GET', '/api/local/runtime')).body.settings.local).toEqual(selected.settings.local);
    expect((await api('POST', path, {scope: {kind: 'workspace', chatId}, selection})).status).toBe(400);
    expect(requests).toEqual(['GET /v1/models']);
  });
});
