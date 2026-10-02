#!/usr/bin/env node
// Canonical role sources -> standalone system prompts, skill bindings, native source roster.
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
if(args.some(x=>x!=='--check')) throw new Error('usage: build-agency-agents.mjs [--check]');
const read=p=>readFileSync(resolve(root,p),'utf8');
const roster=JSON.parse(read('agents/roster.json'));
const common=read('agents/common.md').trim();
const seen=new Set();
const files=new Map();
const agents=roster.agents.map((role,index)=>{
  if(!/^[a-z][a-z0-9-]*$/.test(role.slug)||seen.has(role.slug)) throw new Error('invalid/duplicate role slug');
  if(!/^[A-Za-z ]+$/.test(role.name)) throw new Error('invalid role name');
  if(role.roleSource!==`agents/roles/${role.slug}.md`) throw new Error('invalid role source');
  seen.add(role.slug);
  const bindings=[];
  for(const [level,names] of Object.entries({core:role.coreSkills,supporting:role.supportingSkills,optional:role.optionalSkills})){
    for(const name of names){
      if(!/^[a-z0-9-]+$/.test(name)||bindings.some(x=>x.name===name)) throw new Error(`invalid/duplicate skill ${name}`);
      const path=level==='optional'?`extras/creative-engine/skills/${name}/SKILL.md`:`skills/${name}/SKILL.md`;
      if(!existsSync(resolve(root,path))) throw new Error(`missing skill ${path}`);
      if(!new RegExp(`^name: ${name}$`,'m').test(read(path))) throw new Error(`skill name mismatch ${name}`);
      bindings.push({name,level,path,installation:level==='optional'?'creative pack, separate install':'agency pack'});
    }
  }
  const catalog=['## Skills affectés',
    'Charger le noyau utile à la mission, puis les compléments nécessaires. Résoudre ces noms via le catalogue/outils de skills du runtime ou les dossiers du pack ; ne pas supposer un chemin personnel.',
    `- Noyau : ${role.coreSkills.map(x=>'`'+x+'`').join(', ')}.`,
    `- Compléments : ${role.supportingSkills.map(x=>'`'+x+'`').join(', ')}.`,
    role.optionalSkills.length?`- Moteur créatif optionnel : ${role.optionalSkills.map(x=>'`'+x+'`').join(', ')}. Ces modules ont une installation/dépendance distincte ; leur présence dans la liste ne prouve pas leur disponibilité.`:'- Aucun module tiers optionnel nécessaire par défaut.',
  ].join('\n');
  const systemPrompt=`# ${role.title}\n\n${read(role.roleSource).trim()}\n\n${catalog}\n\n${common}\n`;
  const promptPath=`agents/prompts/${role.slug}.system.md`;
  files.set(promptPath,systemPrompt);
  const folder=`vault/Agents/${role.name}`;
  files.set(`${folder}/${role.name}.md`,systemPrompt);
  files.set(`${folder}/AGENTS.md`,`# ${role.name}\n\nRead \`../../AGENTS.md\`, then \`${role.name}.md\` in this folder. It contains the complete system role and skill assignments. Read only the assigned agency/client/campaign context.\n`);
  files.set(`${folder}/CLAUDE.md`,'@AGENTS.md\n');
  return {slug:role.slug,name:role.name,title:role.title,description:role.description,promptPath,systemPrompt,skills:bindings};
});
if(agents.length!==8||agents[0].slug!=='ceo') throw new Error('requires CEO and seven specialists');
files.set('templates/agency-agents.json',JSON.stringify({schemaVersion:1,status:'private source templates; not an active team',agents},null,2)+'\n');
const path='templates/lead-gen-agency.company-template.json';
const native=JSON.parse(read(path));
native.bots=agents.map((a,i)=>({slug:a.slug,name:a.name,title:a.title,description:a.description,
  instructions:`Read ../../AGENTS.md, then ${a.name}.md in your working folder. That role sheet contains your full system prompt and assigned skills. ${a.description} Load only skills relevant to the task; check actual tools and authorizations. Preserve client boundaries, record evidence and deliver only real artifacts. Use real runtime communication, never simulate delegation.`,
  ...(i===0?{pinned:true,welcome:'Bonjour. Je suis le CEO de votre agence. Je pars de votre contexte et de votre priorité ; les spécialistes seront recrutés au besoin. Aucun travail client ni envoi n’a encore été exécuté.'}:{})}));
files.set(path,JSON.stringify(native,null,2)+'\n');
for(const [path,body] of files){
 if(args.includes('--check')){
  if(!existsSync(resolve(root,path))||read(path)!==body) throw new Error(`stale generated agent file: ${path}`);
 }else{mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),body);}
}
console.log(`Agency agents: ${agents.length} system prompts; all ${agents.reduce((n,a)=>n+a.skills.length,0)} skill bindings resolve.`);
