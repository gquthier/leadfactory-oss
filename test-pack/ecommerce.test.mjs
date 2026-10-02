import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../ecommerce/',import.meta.url));
test('ecommerce ships every vault note, six roles and licensed self-contained skills',()=>{
 const template=JSON.parse(readFileSync(join(root,'template.json'),'utf8'));
 const notes=new Map(template.notes.map(n=>[n.path,n.text]));
 const files=[];
 function walk(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){assert(!e.isSymbolicLink());const p=prefix+e.name;if(e.isDirectory())walk(join(dir,e.name),p+'/');else if(e.name.endsWith('.md'))files.push(p);}}
 walk(join(root,'vault'));assert.equal(notes.size,files.length);
 for(const file of files)assert.equal(notes.get(file),readFileSync(join(root,'vault',file),'utf8'),file);
 assert.equal(template.bots.length,6);assert.equal(new Set(template.bots.map(b=>b.slug)).size,6);assert.deepEqual(template.routines,[]);assert(template.team.name);
 const skills=readdirSync(join(root,'skills'),{withFileTypes:true}).filter(e=>e.isDirectory());assert.equal(skills.length,24);
 for(const s of skills){assert(readFileSync(join(root,'skills',s.name,'SKILL.md'),'utf8').startsWith('---'));assert(readFileSync(join(root,'skills',s.name,'LICENSE.txt'),'utf8').includes('MIT'));}
});
