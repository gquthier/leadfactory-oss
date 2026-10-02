export function cliConnectionCard({connections,api,el,onConnected}){
 const cli=connections.cli;
 const provider=el('select',{'aria-label':'CLI personnel'},[
  el('option',{value:'codex',text:'Codex',selected:cli?.provider!=='claude'}),
  el('option',{value:'claude',text:'Claude Code',selected:cli?.provider==='claude'})
 ]);
 const model=el('input',{type:'text','aria-label':'Modèle du CLI (facultatif)',placeholder:'Vide : modèle par défaut du CLI',value:cli?.model??''});
 const status=el('p',{role:'status',text:connections.provider!=='openrouter'&&cli?`${cli.provider==='claude'?'Claude Code':'Codex'} connecté · ${cli.model||'modèle par défaut du CLI'}`:'Choisissez le CLI installé et déjà connecté sur cet ordinateur.'});
 const button=el('button',{class:'btn primary',text:'Vérifier et connecter mon CLI',onclick:async()=>{
  button.disabled=true;status.textContent='Vérification de l’installation et de la connexion…';
  try{await api('/api/connections/cli',{method:'PUT',body:{provider:provider.value,model:model.value}});await onConnected();}
  catch(e){status.textContent=e.message;}finally{button.disabled=false;}
 }});
 return el('div',{class:'card stack'},[
  el('h2',{text:'2. IA personnelle — connecter mon CLI'}),
  el('p',{text:'Utilisez votre connexion Claude Code ou Codex existante, sans clé API à saisir. Le cockpit et le CLI doivent fonctionner sur la même machine.'}),
  provider,model,button,status,
  el('p',{class:'hint',text:'Première connexion dans le terminal : « codex login » ou « claude auth login ». Lancez ensuite « npm run demo » depuis ce terminal. La vérification ne génère aucun texte.'}),
  el('p',{class:'hint',text:'Après création d’un lien en mode IA, les quatre rôles démarrent à la fin du questionnaire. Les textes sont traités par le fournisseur de votre CLI et utilisent les limites de votre compte. La machine doit rester allumée.'})
 ]);
}
