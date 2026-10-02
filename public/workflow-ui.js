const links = new Map();
export function workflowCard({client,api,el,toast,onLinkSaved=()=>{}}){
 const panel=el('section',{class:'card stack'},[el('h2',{text:'Lien client → proposition de campagne'}),el('p',{text:'Un questionnaire privé, puis quatre étapes de travail : Onboarding → Créatif stratégiste → Media Buyer → Communication client.'})]);
 const mode=el('select',{'aria-label':'Mode du parcours'},[el('option',{value:'demo',text:'Démo sans IA — aucun appel fournisseur'}),el('option',{value:'ai',text:'Agents IA — connexion personnelle, 4 appels maximum'})]);
 const link=el('div',{class:'stack'}),runs=el('div',{class:'stack'}),error=el('p',{class:'error',role:'alert'});
 const act=async fn=>{error.textContent='';try{await fn();}catch(e){error.textContent=e.message;}};
 if(links.has(client.id))link.append(el('input',{value:links.get(client.id),readOnly:true,'aria-label':'Lien privé du client'}),el('a',{class:'btn',href:links.get(client.id),target:'_blank',rel:'noopener noreferrer',text:'Ouvrir le formulaire client'}));
 const create=el('button',{class:'btn primary',text:'Créer le lien d’onboarding',onclick:()=>act(async()=>{
  create.disabled=true;try{const i=await api(`/api/clients/${client.id}/invite`,{method:'POST',body:{mode:mode.value}});const input=el('input',{value:i.url,readOnly:true,'aria-label':'Lien privé du client'});
   links.set(client.id, i.url); link.replaceChildren(el('p',{text:'Lien valable 7 jours. Toute personne qui le possède accède à ce dossier. Un nouveau lien révoque le précédent.'}),input,el('a',{class:'btn',href:i.url,target:'_blank',rel:'noopener noreferrer',text:'Ouvrir le formulaire client'}));onLinkSaved(panel);toast('Lien créé.');
  }finally{create.disabled=false;}
 })});
 async function load(){const w=await api('/api/workflow');const list=w.runs.filter(r=>r.clientId===client.id).toReversed();runs.replaceChildren();
  if(!w.portalUrl)runs.append(el('p',{text:'Le portail est disponible avec le lancement « npm run demo » du pack autonome.'}));
  const labels={queued:'En attente',running:'Travail en cours',needs_review:'Proposition à relire',published:'Proposition partagée',failed:'Échec',stopped:'Arrêtée',interrupted:'Interrompue'};
  for(const r of list){const row=el('div',{class:'card stack'},[el('h3',{text:labels[r.status]}),el('p',{text:`${r.mode==='demo'?'Démo sans IA':'IA · '+(r.provider??'openrouter')+' · '+(r.model||'modèle par défaut du CLI')} · ${r.steps.length}/4 étapes · ${new Date(r.createdAt).toLocaleString('fr-FR')}`})]);
   for(const s of r.steps){const d=el('details',{},[el('summary',{text:`✓ ${s.role} · ${s.source==='ai'?'IA':'modèle prérempli'}`}),el('div',{class:'pre',text:s.content})]);row.append(d);}
   if(r.error)row.append(el('p',{text:r.error,class:'error'}));
   if(['queued','running'].includes(r.status))row.append(el('button',{class:'btn danger',text:'Arrêter cette mission',onclick:()=>act(async()=>{await api(`/api/workflow/${r.id}/stop`,{method:'POST',body:{}});await load();})}));
   if(['needs_review','published'].includes(r.status))row.append(el('button',{class:'btn primary',text:r.status==='published'?'Actualiser la proposition partagée':'Partager la proposition relue au client',onclick:()=>act(async()=>{await api(`/api/workflow/${r.id}/publish`,{method:'POST',body:{}});toast('Proposition disponible sur le lien client.');await load();})}));
   runs.append(row);
  }
 }
 panel.append(mode,el('p',{class:'hint',text:'Le mode IA autorise la rédaction dès soumission sur votre fournisseur personnel (4 exécutions maximum ; CLI limité à 3 minutes par rôle). Aucun envoi email, rendu vidéo ou achat média automatique.'}),create,link,el('button',{class:'btn',text:'Actualiser le suivi',onclick:()=>act(load)}),error,runs);
 act(load);return panel;
}
