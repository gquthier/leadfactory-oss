const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import {createApp} from '../lib/app.mjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
const out=process.env.E2E_OUTPUT || await fs.mkdtemp(path.join(os.tmpdir(),'leadfactory-ui-'));await fs.mkdir(out,{recursive:true});
const cliFixture=process.env.CLI_FIXTURE==='1';let cliCalls=0;
const localCli=cliFixture?{probe:async provider=>({provider,installed:true,compatible:true,authenticated:true,checkedAt:new Date().toISOString()}),complete:async()=>{cliCalls++;return {content:'# Proposition fictive de recette CLI\n\n### 4. Budget et économie\n\nBudget de test à valider.',model:'fixture-model',usage:{promptTokens:1,completionTokens:1},finishReason:'stop'};}}:undefined;
const app=await createApp({localCli,dataDir:await fs.mkdtemp(path.join(os.tmpdir(),'leadfactory-ui-db-'))});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));await new Promise(r=>app.portalServer.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try {
const admin=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];admin.on('pageerror',e=>errors.push(e.message));
await admin.goto(`http://127.0.0.1:${app.server.address().port}`);
if(cliFixture){await admin.getByRole('button',{name:'Start Here',exact:true}).click();await admin.getByLabel('CLI personnel').selectOption('codex');await admin.getByRole('button',{name:'Vérifier et connecter mon CLI'}).click();await admin.getByText('Codex connecté · modèle par défaut du CLI',{exact:true}).waitFor();await admin.screenshot({path:out+'/00-cli.png',fullPage:true});}
await admin.getByRole('button',{name:'Clients',exact:true}).click();await admin.getByRole('button',{name:'Nouveau client',exact:true}).click();
await admin.getByLabel('Nom de l’entreprise').fill('Atelier Vert — démonstration fictive');await admin.getByRole('dialog').getByRole('button',{name:'Enregistrer',exact:true}).click();
await admin.getByRole('button',{name:'Ouvrir',exact:true}).first().click();
if(cliFixture)await admin.getByLabel('Mode du parcours').selectOption('ai');
await admin.getByRole('button',{name:'Créer le lien d’onboarding'}).click();
const link=await admin.getByRole('textbox',{name:'Lien privé du client'}).inputValue();
await admin.screenshot({path:out+'/01-cockpit.png',fullPage:true});
const client=await browser.newPage({viewport:{width:1150,height:1050}});client.on('pageerror',e=>errors.push(e.message));await client.goto(link);
await client.getByLabel('Site web').fill('https://atelier-vert.example');await client.getByLabel('Interlocuteur principal').fill('Nadia Exemple');
await client.getByRole('button',{name:'Enregistrer et continuer'}).click();
await client.getByLabel('Service ou produit vendu').fill('Audit énergétique des bâtiments professionnels');await client.getByLabel('Problème résolu').fill('Des dépenses énergétiques mal comprises');await client.getByLabel('Promesse principale').fill('Identifier et prioriser les améliorations possibles');
await client.getByRole('button',{name:'Enregistrer et continuer'}).click();await client.getByLabel('Profil client idéal').fill('Dirigeants de PME industrielles');await client.getByLabel('Exclusions / no-go').fill('Particuliers, secteur public');await client.getByRole('button',{name:'Enregistrer et continuer'}).click();
await client.getByLabel('Canal principal').selectOption('meta');await client.getByLabel('Objectif de la campagne').fill('Tester la demande pour des audits qualifiés');await client.getByLabel('Définition d’un lead qualifié').fill('Décideur avec projet identifié et site professionnel');await client.getByLabel('KPI de suivi').fill('Coût par rendez-vous qualifié tenu');await client.getByLabel('Budget mensuel').fill('1500');
await client.screenshot({path:out+'/02-formulaire.png',fullPage:true});await client.getByRole('button',{name:'Enregistrer et continuer'}).click();await client.getByLabel('Responsable de la validation').fill('Nadia');await client.getByRole('button',{name:'Terminer mon onboarding'}).click();await client.getByRole('heading',{name:'Merci, votre brief est enregistré.'}).waitFor();
await admin.getByRole('button',{name:'Actualiser le suivi'}).click();await admin.getByRole('button',{name:'Partager la proposition relue au client'}).waitFor();await admin.getByRole('heading',{name:'Campagnes (1)',exact:true}).waitFor({timeout:10000});
await admin.screenshot({path:out+'/03-workflow.png',fullPage:true});await admin.getByRole('button',{name:'Partager la proposition relue au client'}).click();
await client.getByRole('heading',{name:'Votre proposition de campagne',exact:true}).waitFor();await client.getByRole('heading',{name:'4. Budget et économie',exact:true}).waitFor();await client.screenshot({path:out+'/04-proposition.png',fullPage:true});
if(cliFixture&&cliCalls!==4)throw new Error('Expected four CLI calls');
if(errors.length)throw new Error(errors.join('\n'));await fs.writeFile(out+'/result.json',JSON.stringify({status:'passed',mode:cliFixture?'CLI simulated adapter':'demo without AI',cliCalls,pageErrors:errors,steps:['create client','issue link','fill five steps','submit','four automatic draft stages','operator share','client reads proposal']},null,2));console.log('UI scenario passed');
} finally {await browser.close();await app.close();}
