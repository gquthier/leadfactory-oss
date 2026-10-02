import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createStarterConnections} from '../src/lib/starter-connections';
test('tokens stay server-side; only explicit readonly tests call provider; failed test never leaks body',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lf-connect-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
 const c=createStarterConnections({dir,fetchImpl:async(url:any,init:any)=>{calls++;assert.equal(url,'https://slack.com/api/auth.test');assert.equal(init.headers.Authorization,'Bearer xoxb-fixture-only');return new Response(JSON.stringify({ok:true,user_id:'private-identity'}));}});
 await c.save({service:'slack',token:'xoxb-fixture-only'});assert.equal(calls,0);assert.equal((await c.view()).slack.configured,true);assert.ok(!JSON.stringify(await c.view()).includes('fixture-only'));
 await c.test('slack');assert.equal(calls,1);assert.equal((await c.view()).slack.status,'verified');assert.ok(!JSON.stringify(await c.view()).includes('private-identity'));assert.equal((await fs.stat(path.join(dir,'integrations.json'))).mode&0o777,0o600);
 await c.remove('slack');assert.equal((await c.view()).slack.configured,false);await assert.rejects(c.save({service:'url',token:'secret'}));
});
