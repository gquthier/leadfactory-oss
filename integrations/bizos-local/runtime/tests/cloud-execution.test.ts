import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../src/harness/storage.js';
import type { ConversationContinuity } from '../src/harness/continuity-sync.js';
import { ContinuityBridgeError } from '../src/continuity-bridge.js';
import { CloudExecution } from '../src/harness/cloud-execution.js';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root,{recursive:true,force:true})));
function fixture() {
  const root = mkdtempSync(join(tmpdir(),'cloud-execution-')); roots.push(root);
  const storage = new Storage(root);
  const link = { accountId:'owner',orgId:'org',conversationId:'canonical',installationId:'mac' };
  const response = {eventId:'event',duplicate:false,runs:[{runId:'run',threadId:'canonical',agentId:'marketing',triggerMessageId:'1',state:'queued',error:null,createdAt:'now',updatedAt:'now'}]};
  const state = {available:true,active:false,model:'policy-model'};
  const cloud = vi.fn(async (_thread:string,operation:string) => operation==='cloud/status' ? state : response);
  const enabled = {value:true};
  const continuity = {store:{status:()=>link},sync:vi.fn(async()=>{}),cloud,backupEnabled:()=>enabled.value} as unknown as ConversationContinuity;
  return {manager:new CloudExecution(storage,continuity),storage,continuity,cloud,link,response,state,enabled};
}
it('selection persists and makes no inference request',async()=>{
  const f=fixture(); await f.manager.select('bot:marketing','bizos');
  expect(f.cloud.mock.calls.map(call=>call[1])).toEqual(['cloud/status']);
  expect(new CloudExecution(f.storage,f.continuity).destination('bot:marketing')).toBe('bizos');
});
it('a lost send blocks switching, retains the retry identity and never falls back',async()=>{
  const f=fixture(); await f.manager.select('bot:marketing','bizos');
  f.cloud.mockRejectedValueOnce(new Error('offline'));
  await expect(f.manager.send('bot:marketing','message','hello')).rejects.toThrow('offline');
  await expect(f.manager.select('bot:marketing','personal')).rejects.toThrow('unconfirmed');
  await expect(f.manager.disableBackup()).rejects.toThrow('unconfirmed');
  await expect(f.manager.send('bot:marketing','message','different')).rejects.toThrow('already used');
  await f.manager.send('bot:marketing','message','hello');
  expect(f.cloud.mock.calls.filter(call=>call[1]==='cloud/send')).toHaveLength(2);
});
it('another account or canonical conversation cannot reuse the saved selection',async()=>{
  const f=fixture(); await f.manager.select('bot:marketing','bizos'); f.link.accountId='other';
  await expect(f.manager.send('bot:marketing','message','hello')).rejects.toThrow('another account');
  expect(f.cloud.mock.calls.map(call=>call[1])).toEqual(['cloud/status']);
});
it('QuickChat and groups may use a saved conversation binding',async()=>{
  const f=fixture();
  for(const thread of [`chat:qchat_${'a'.repeat(32)}`,'group:a']) expect((await f.manager.status(thread)).available).toBe(true);
  expect(f.cloud).toHaveBeenCalledTimes(2);
});
it('turning backup off clears the BizOS execution choice',async()=>{
  const f=fixture();await f.manager.select('bot:marketing','bizos');
  await f.manager.disableBackup();f.enabled.value=false;
  expect(f.manager.destination('bot:marketing')).toBe('personal');
  expect((await f.manager.status('bot:marketing')).available).toBe(false);
  await expect(f.manager.select('bot:marketing','bizos')).rejects.toThrow('Enable conversation backup');
});
it('personal remains selectable after cloud policy withdrawal when no work is active',async()=>{
  const f=fixture(); await f.manager.select('bot:marketing','bizos'); f.state.available=false;
  expect((await f.manager.select('bot:marketing','personal')).destination).toBe('personal');
});
it('a reply or STOP for another conversation is refused',async()=>{
  const f=fixture(); await f.manager.select('bot:marketing','bizos'); await f.manager.send('bot:marketing','message','hello');
  f.cloud.mockResolvedValueOnce({run:{...f.response.runs[0],threadId:'other'}} as never);
  await expect(f.manager.run('cloud_run',true)).rejects.toThrow('different run');
});

it('a completed cloud retry keeps its original route after selecting personal',async()=>{
  const f=fixture(); await f.manager.select('bot:marketing','bizos'); await f.manager.send('bot:marketing','message','hello');
  await f.manager.select('bot:marketing','personal');
  const before=f.cloud.mock.calls.length;
  expect((await f.manager.send('bot:marketing','message','hello')).duplicate).toBe(true);
  expect(f.cloud.mock.calls.length).toBe(before);
});

it('a definitive first refusal survives restart and permits an explicit personal return',async()=>{
  const f=fixture(); await f.manager.select('bot:marketing','bizos');
  f.cloud.mockRejectedValueOnce(new ContinuityBridgeError(409,'policy_changed','policy_changed',true));
  await expect(f.manager.send('bot:marketing','message','hello')).rejects.toThrow('policy_changed');
  const restored=new CloudExecution(f.storage,f.continuity);
  expect(restored.ownsRequest('message')).toBe(false);
  expect((await restored.select('bot:marketing','personal')).destination).toBe('personal');
});
it('a later definitive refusal cannot erase an earlier unknown outcome',async()=>{
  const f=fixture(); await f.manager.select('bot:marketing','bizos');
  f.cloud.mockRejectedValueOnce(new Error('network timeout'));
  await expect(f.manager.send('bot:marketing','message','hello')).rejects.toThrow('timeout');
  f.cloud.mockRejectedValueOnce(new ContinuityBridgeError(409,'policy_changed','policy_changed',true));
  await expect(f.manager.send('bot:marketing','message','hello')).rejects.toThrow('policy_changed');
  await expect(new CloudExecution(f.storage,f.continuity).select('bot:marketing','personal')).rejects.toThrow('unconfirmed');
});
it('local size validation and pre-dispatch sync failure do not create unknown requests',async()=>{
  const f=fixture(); await f.manager.select('bot:marketing','bizos');
  await expect(f.manager.send('bot:marketing','oversize','x'.repeat(10001))).rejects.toThrow('10000');
  vi.mocked(f.continuity.sync).mockRejectedValueOnce(new Error('sync failed'));
  await expect(f.manager.send('bot:marketing','sync','hello')).rejects.toThrow('sync failed');
  expect(f.manager.ownsRequest('oversize')).toBe(false);
  expect(f.manager.ownsRequest('sync')).toBe(false);
  expect((await f.manager.select('bot:marketing','personal')).destination).toBe('personal');
});
it('an HTTP error without an explicit refusal marker remains unknown',async()=>{
  const f=fixture(); await f.manager.select('bot:marketing','bizos');
  f.cloud.mockRejectedValueOnce(new ContinuityBridgeError(400,'invalid_body','invalid_body',false));
  await expect(f.manager.send('bot:marketing','message','hello')).rejects.toThrow();
  await expect(f.manager.select('bot:marketing','personal')).rejects.toThrow('unconfirmed');
});
