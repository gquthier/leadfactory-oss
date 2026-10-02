import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const bundle=JSON.parse(read('templates/agency-agents.json'));
const native=JSON.parse(read('templates/lead-gen-agency.company-template.json'));

test('eight standalone prompts match the native role sheets and reference real skills',()=>{
  assert.deepEqual(bundle.agents.map(x=>x.slug),['ceo','acquisition','onboarding','delivery','media-buyer','cold-email','creative-strategist','client-communication']);
  assert.deepEqual(native.bots.map(x=>x.slug),bundle.agents.map(x=>x.slug));
  const skillNames=new Set();
  for(const a of bundle.agents){
    assert.equal(read(a.promptPath),a.systemPrompt);
    assert.equal(read(`vault/Agents/${a.name}/${a.name}.md`),a.systemPrompt);
    assert.equal(native.notes.find(n=>n.path===`Agents/${a.name}/${a.name}.md`).text,a.systemPrompt);
    assert.ok(a.systemPrompt.includes(read('agents/common.md').trim()));
    for(const s of a.skills){
      assert.match(read(s.path),new RegExp(`^name: ${s.name}$`,'m'));
      assert.ok(a.systemPrompt.includes('`'+s.name+'`'));
      if(s.level!=='optional')skillNames.add(s.name);
    }
  }
  assert.deepEqual([...skillNames].sort(),readdirSync(resolve(root,'skills'),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort());
});

test('creative dependencies are optional and generator has no drift',()=>{
  assert.equal(bundle.agents.flatMap(x=>x.skills.filter(s=>s.level==='optional')).length,12);
  assert.ok(bundle.agents.filter(x=>x.slug!=='creative-strategist').every(x=>!x.skills.some(s=>s.level==='optional')));
  const checked=spawnSync(process.execPath,['scripts/build-agency-agents.mjs','--check'],{cwd:root,encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
  assert.deepEqual(native.routines,[]);
});
