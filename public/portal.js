const root=document.getElementById('root');
let token=location.hash.slice(1)||sessionStorage.getItem('lf-portal-token')||'';
if(location.hash){sessionStorage.setItem('lf-portal-token',token);history.replaceState(null,'',location.pathname);}
let data,step=0,poll;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
async function api(method='GET',body){const r=await fetch('/portal/api',{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}
function documentView(text){
 const box=el('article',null,'proposal');let paragraph=[];
 const flush=()=>{if(paragraph.length){box.append(el('p',paragraph.join('\n')));paragraph=[];}};
 for(const line of text.split('\n')){
  const heading=/^(#{1,3}) (.+)$/.exec(line.trim());
  if(heading){flush();box.append(el(heading[1].length===1?'h2':'h3',heading[2]));}
  else if(!line.trim())flush();else paragraph.push(line);
 }
 flush();return box;
}
async function refresh(){try{data=await api();render();}catch(e){root.replaceChildren(el('h1','Espace indisponible'),el('p',e.message));}}
function render(){
 clearTimeout(poll);root.replaceChildren(el('div','VOTRE PROCHAINE CAMPAGNE','eyebrow'),el('h1',data.company),el('p','Posons les bases d’une campagne claire, réaliste et fidèle à votre entreprise.'));
 if(data.mode==='demo')root.append(el('p','Démonstration sans IA : les documents sont préremplis à partir de vos réponses.','pill'));
 if(data.submitted){
  const panel=el('section',null,'panel');panel.append(el('h2',data.proposal?'Votre proposition de campagne':'Merci, votre brief est enregistré.'));
  if(data.proposal)panel.append(el('p','Proposition transmise par l’agence. Contactez votre interlocuteur pour valider ou demander un ajustement.'),documentView(data.proposal.content));
  else {panel.append(el('p',['failed','stopped','interrupted','needs_update'].includes(data.status)?'L’équipe doit reprendre votre dossier. Vos réponses sont conservées.':'Votre proposition est en préparation. Elle apparaîtra ici après la revue de l’agence.'));poll=setTimeout(refresh,2500);}
  root.append(panel);return;
 }
 const steps=el('div',null,'steps');data.schema.steps.forEach((s,i)=>{const n=el('span',null,i<=step?'done':'');n.title=s.label;steps.append(n);});root.append(steps);
 const def=data.schema.steps[step],panel=el('form',null,'panel');panel.append(el('div',`ÉTAPE ${step+1} / ${data.schema.steps.length}`,'eyebrow'),el('h2',def.label));
 const inputs={};for(const f of def.fields){const id=`${def.key}-${f.name}`,label=el('label',f.label+(f.required?' *':''));label.htmlFor=id;
  const input=el(f.type==='textarea'?'textarea':f.type==='channel'?'select':'input');input.id=id;input.name=f.name;
  if(f.type==='channel')for(const channel of data.schema.channels){const opt=el('option',{'meta':'Meta Ads','google':'Google Ads','cold-email':'Cold email','organic':'Organique'}[channel]||channel);opt.value=channel;input.append(opt);}
  else if(f.type!=='textarea')input.type=f.type==='bool'?'checkbox':f.type==='number'?'number':f.name.toLowerCase().includes('email')?'email':'text';
  if(f.type==='number'){input.min='0';input.step='any';}
  if(f.type==='bool')input.checked=Boolean(data.onboarding[def.key][f.name]);else input.value=data.onboarding[def.key][f.name]??'';
  input.required=f.required;inputs[f.name]=input;panel.append(label,input);if(f.hint)panel.append(el('p',f.hint,'hint'));
 }
 const error=el('p',null,'error');error.setAttribute('role','alert');panel.append(error);
 const actions=el('div',null,'actions'),back=el('button','Précédent'),save=el('button','Enregistrer'),next=el('button',step===data.schema.steps.length-1?'Terminer mon onboarding':'Enregistrer et continuer','primary');
 back.type=save.type='button';next.type='submit';back.disabled=step===0;
 async function persist(){const section={};for(const f of def.fields){const input=inputs[f.name];section[f.name]=f.type==='bool'?input.checked:f.type==='number'?(input.value===''?null:Number(input.value)):input.value;}
  await api('PUT',{[def.key]:section,step});data=await api();}
 async function act(fn){error.textContent='';for(const b of [back,save,next])b.disabled=true;try{await fn();}catch(e){error.textContent=e.message;for(const b of [back,save,next])b.disabled=false;back.disabled=step===0;}}
 back.onclick=()=>act(async()=>{await persist();step--;render();});save.onclick=()=>act(async()=>{await persist();render();});
 panel.onsubmit=e=>{e.preventDefault();act(async()=>{await persist();if(step===data.schema.steps.length-1){await api('POST',{action:'submit'});await refresh();}else{step++;render();}});};
 actions.append(back,save,next);panel.append(actions);root.append(panel);
}
try{data=await api();step=Math.min(data.onboarding.step??0,data.schema.steps.length-1);render();}catch(e){root.replaceChildren(el('h1','Votre lien privé est nécessaire'),el('p',e.message));}
