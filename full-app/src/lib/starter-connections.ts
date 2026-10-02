import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLocalCli} from '../../../lib/local-cli.mjs';
const names=['slack','meta','elevenlabs','openrouter'] as const;
type Service=typeof names[number];
type Entry={token?:string;model?:string;version?:string;status?:string;verifiedAt?:string|null};
type Config={services:Partial<Record<Service,Entry>>;ai?:{provider:'codex'|'claude'|'openrouter';model:string;verifiedAt:string};automation?:boolean};
const empty=():Config=>({services:{},automation:false});
export function createStarterConnections({dir=process.env.LEADFACTORY_STARTER_DATA_DIR||path.join(process.cwd(),'.local-data'),fetchImpl=fetch,cli=createLocalCli()}:{dir?:string;fetchImpl?:typeof fetch;cli?:any}={}){
 let queue=Promise.resolve();const file=path.join(dir,'integrations.json');
 async function read():Promise<Config>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e:any){if(e.code==='ENOENT')return empty();throw new Error('Configuration illisible.');}}
 async function update(fn:(c:Config)=>void|Promise<void>){const task=queue.then(async()=>{const c=await read();await fn(c);await fs.mkdir(dir,{recursive:true,mode:0o700});const tmp=path.join(dir,'.integrations-'+randomUUID());await fs.writeFile(tmp,JSON.stringify(c,null,2),{mode:0o600});await fs.rename(tmp,file);});queue=task.catch(()=>{});return task;}
 function service(s:string):Service{if(!names.includes(s as Service))throw new Error('Service inconnu.');return s as Service;}
 async function view(){const c=await read();return {...Object.fromEntries(names.map(id=>[id,{configured:!!c.services[id]?.token,status:c.services[id]?.status??'not_configured',verifiedAt:c.services[id]?.verifiedAt??null,model:c.services[id]?.model??''}])),ai:c.ai??null,automation:!!c.automation} as any;}
 async function save(body:any){const id=service(body?.service);if(body.token!==undefined&&(typeof body.token!=='string'||body.token.length>2048||/\s/.test(body.token)))throw new Error('Token invalide.');await update(c=>{const prior=c.services[id]??{};c.services[id]={...prior,...(body.token?{token:body.token}:{}),model:typeof body.model==='string'?body.model.slice(0,120):prior.model,version:typeof body.version==='string'&&/^v\d+\.\d+$/.test(body.version)?body.version:prior.version,status:'configured',verifiedAt:null};if(!c.services[id]?.token)throw new Error('Renseigner votre token personnel.');});}
 async function test(idRaw:string){const id=service(idRaw),c=await read(),entry=c.services[id];if(!entry?.token)throw new Error('Aucun token configuré.');
  const url=id==='slack'?'https://slack.com/api/auth.test':id==='meta'?`https://graph.facebook.com/${entry.version||'v25.0'}/me?fields=id`:id==='elevenlabs'?'https://api.elevenlabs.io/v1/user':'https://openrouter.ai/api/v1/key';
  let ok=false;try{const res=await fetchImpl(url,{method:id==='slack'?'POST':'GET',headers:id==='elevenlabs'?{'xi-api-key':entry.token}:{Authorization:`Bearer ${entry.token}`},signal:AbortSignal.timeout(15000)});const data=await res.json();ok=res.ok&&(id!=='slack'||data.ok===true)&&!data.error;}catch{}
  await update(current=>{if(current.services[id]?.token!==entry.token)throw new Error('Connexion modifiée : vérifier à nouveau.');current.services[id]={...current.services[id],status:ok?'verified':'error',verifiedAt:ok?new Date().toISOString():null};});
  if(!ok)throw new Error('Accès refusé ou service indisponible. Vérifier token, permissions et version API ; aucun message ni campagne envoyé.');
  return {verified:true,scope:'Identité du compte seulement ; campagnes et permissions métier non testées.'};
 }
 async function connectAI(body:any){if(!['codex','claude','openrouter'].includes(body.provider))throw new Error('Choisir Codex, Claude Code ou OpenRouter.');const model=typeof body.model==='string'?body.model.trim():'';if(model&&!/^[A-Za-z0-9][A-Za-z0-9._/:-]{0,119}$/.test(model))throw new Error('Identifiant de modèle invalide.');
  if(body.provider==='openrouter'){const c=await read();if(!c.services.openrouter?.token||!model)throw new Error('Configurer votre token OpenRouter et le modèle.');}
  else{const p=await cli.probe(body.provider);if(!p.installed||!p.compatible||!p.authenticated)throw new Error('CLI absent, ancien ou non connecté. Installer/mettre à jour, se connecter dans le terminal, puis relancer le cockpit.');}
  await update(c=>{c.ai={provider:body.provider,model,verifiedAt:new Date().toISOString()};c.automation=body.automation===true;});
 }
 async function remove(idRaw:string){const id=service(idRaw);await update(c=>{delete c.services[id];if(c.ai?.provider===id){delete c.ai;c.automation=false;}});}
 return {view,save,test,connectAI,remove,read,cli};
}
const holder=globalThis as typeof globalThis & {__lfConnections?:ReturnType<typeof createStarterConnections>};
export const starterConnections=holder.__lfConnections??=createStarterConnections();
