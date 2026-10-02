import {fingerprint} from './workflow.mjs';
// This listener exposes ONLY the client portal. The operator API stays loopback.
import http from 'node:http';
import {sendJson,sendError,serveStatic,readJsonBody,checkHost} from './http.mjs';
import {HttpError} from './validate.mjs';
import {emptyOnboarding,onboardingDraft,onboardingProgress,ONBOARDING_SCHEMA} from './onboarding.mjs';
import {submitOnboarding} from './submit-onboarding.mjs';
export function portalOrigin(value){
 if(!value)return null;
 let u;try{u=new URL(value);}catch{throw new Error('PORTAL_ORIGIN invalide.');}
 if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw new Error('PORTAL_ORIGIN : origine HTTPS sans chemin attendue (HTTP local permis).');
 return u.origin;
}
export function createPortal({store,workflow,publicDir,origin=null}){
 const allowed=portalOrigin(origin);
 const server=http.createServer((req,res)=>handle(req,res).catch(e=>sendError(res,e)));
 server.requestTimeout=30000;server.headersTimeout=15000;
 function baseUrl(){const addr=server.address();return allowed||(addr?`http://127.0.0.1:${addr.port}`:null);}
 async function handle(req,res){
  if(allowed){if(req.headers.host!==new URL(allowed).host)throw new HttpError(403,'Hôte du portail refusé.');}else checkHost(req);
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const u=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&['/','/portal.js','/portal.css'].includes(u.pathname))return serveStatic(res,publicDir,u.pathname==='/'?'/portal.html':u.pathname);
  if(u.pathname!=='/portal/api')throw new HttpError(404,'Ressource introuvable.');
  if(!['GET','PUT','POST'].includes(req.method))throw new HttpError(405,'Méthode non autorisée.');
  if(req.headers.origin&&req.headers.origin!==(allowed||`http://${req.headers.host}`))throw new HttpError(403,'Origine refusée.');
  if(req.headers['sec-fetch-site']&& !['same-origin','none'].includes(req.headers['sec-fetch-site']))throw new HttpError(403,'Origine refusée.');
  const token=req.headers.authorization?.replace(/^Bearer /,'');
  if(req.method==='GET'){
   const db=store.read(),invite=workflow.authorize(db,token),c=db.clients.find(x=>x.id===invite.clientId),r=db.automation.runs.find(x=>x.id===invite.runId);
   return sendJson(res,200,{company:c.company,schema:ONBOARDING_SCHEMA,onboarding:c.onboarding??emptyOnboarding(),progress:onboardingProgress(c.onboarding??emptyOnboarding()),submitted:Boolean(invite.runId),mode:invite.mode,status:r&&fingerprint(c)!==r.fingerprint?'needs_update':r?.status??'draft',proposal:r&&fingerprint(c)===r.fingerprint?r.published??null:null,expiresAt:invite.expiresAt});
  }
  workflow.authorize(store.read(),token);
  if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))throw new HttpError(415,'JSON attendu.');
  const body=await readJsonBody(req,100000);
  const result=await store.update(db=>{
   const i=workflow.authorize(db,token),c=db.clients.find(x=>x.id===i.clientId);
   if(req.method==='PUT'){
    if(i.runId)throw new HttpError(409,'Questionnaire déjà soumis. Demandez un nouveau lien pour une modification.');
    c.onboarding=onboardingDraft(body,c.onboarding);c.onboarding.status='draft';c.onboarding.reviewedAt=null;c.updatedAt=new Date().toISOString();return {saved:true,progress:onboardingProgress(c.onboarding)};
   }
   if(body?.action!=='submit')throw new HttpError(400,'Action inconnue.');
   if(!i.runId){submitOnboarding(db,c.id);workflow.enqueue(db,i,c);}
   return {submitted:true};
  });
  workflow.wake();return sendJson(res,200,result);
 }
 return {server,baseUrl};
}
