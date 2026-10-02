import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tempDir} from './harness.mjs';
import {createLocalCli, cliArgs, parseCliResult} from '../lib/local-cli.mjs';

async function fixture(t, body) {
 const dir=await tempDir();t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'fixture');await fs.writeFile(file,`#!${process.execPath}\n${body}`,{mode:0o700});
 return file;
}
test('CLI parsers require completed output, retain real identity and reject provider errors',()=>{
 const c=parseCliResult('claude',JSON.stringify({type:'result',subtype:'success',result:'Bonjour',modelUsage:{'actual-model':{}},usage:{input_tokens:12,output_tokens:3},total_cost_usd:0.01}),'requested');
 assert.equal(c.content,'Bonjour');assert.equal(c.model,'actual-model');assert.equal(c.usage.completionTokens,3);
 const x=parseCliResult('codex',[{type:'item.completed',item:{type:'agent_message',text:'Proposition'}},{type:'turn.completed',usage:{input_tokens:10,output_tokens:4}}].map(JSON.stringify).join('\n'),'requested');
 assert.equal(x.model,null);assert.equal(x.requestedModel,'requested');assert.equal(x.content,'Proposition');
 for(const s of ['{}','not json',JSON.stringify({type:'result',is_error:true,result:'secret quota exceeded'})])assert.throws(()=>parseCliResult('claude',s,''));
 assert.throws(()=>parseCliResult('codex','{"type":"turn.failed","error":{"message":"secret"}}',''));
});
test('fixed CLI args keep auth, disable personal customizations and never bypass permissions',()=>{
 const c=cliArgs('claude','exact-model');assert.ok(c.includes('--safe-mode'));assert.ok(c.includes('--no-session-persistence'));assert.equal(c[c.indexOf('--tools')+1],'');
 const x=cliArgs('codex','exact-model');assert.ok(x.includes('--ignore-user-config'));assert.equal(x[x.indexOf('--sandbox')+1],'read-only');
 assert.ok(x.includes('exact-model'));assert.ok(![...c,...x].some(a=>a.includes('bypass')||a==='--bare'));
 assert.throws(()=>cliArgs('sh',''));assert.throws(()=>cliArgs('codex','x;touch /tmp/no'));
});
test('subprocess receives prompt on stdin, isolated cwd, and returns bounded structured text',async t=>{
 const exe=await fixture(t,`let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{console.log(JSON.stringify({type:'result',subtype:'success',result:JSON.stringify({input,cwd:process.cwd(),args:process.argv.slice(2)}),modelUsage:{'fixture-model':{}},usage:{input_tokens:1,output_tokens:2}}))});`);
 const cli=createLocalCli({executables:{claude:exe}});
 const r=await cli.complete({provider:'claude',model:'fixture-model',messages:[{role:'user',content:'$(do not execute) client A'}]});
 const out=JSON.parse(r.content);assert.match(out.input,/client A/);assert.match(out.cwd,/leadfactory-cli-/);assert.ok(!out.args.some(a=>a.includes('client A')));
 await assert.rejects(fs.stat(out.cwd),{code:'ENOENT'});
});
test('STOP, timeout and excessive output terminate actual child processes with safe errors',async t=>{
 const exe=await fixture(t,"process.stdin.resume();setInterval(()=>{},1000);");
 const cli=createLocalCli({executables:{codex:exe},timeoutMs:150});
 await assert.rejects(cli.complete({provider:'codex',messages:[]}),/Délai/);
 const controller=new AbortController();const running=createLocalCli({executables:{codex:exe}}).complete({provider:'codex',messages:[],signal:controller.signal});
 setTimeout(()=>controller.abort(),100);await assert.rejects(running,/arrêtée/);
 const noisy=await fixture(t,"process.stdout.write('private'.repeat(200000));setInterval(()=>{},1000);");
 await assert.rejects(createLocalCli({executables:{codex:noisy}}).complete({provider:'codex',messages:[]}),/volumineuse/);
 const missing=createLocalCli({executables:{codex:'/no/such/cli'}});assert.equal((await missing.probe('codex')).installed,false);
});
test('probe checks supported flags and login without returning account output or making inference',async t=>{
 const exe=await fixture(t,`const a=process.argv.slice(2); if(a.includes('--version'))console.log('test 1.0');else if(a.includes('--help'))console.log('--safe-mode --tools --no-session-persistence');else console.log(JSON.stringify({loggedIn:true,email:'private@example.com'}));`);
 const result=await createLocalCli({executables:{claude:exe}}).probe('claude');
 assert.equal(result.authenticated,true);assert.equal(result.compatible,true);assert.ok(!JSON.stringify(result).includes('private@example'));
});
