import {readFileSync,writeFileSync} from 'node:fs';
import {ONBOARDING_SCHEMA} from '../lib/onboarding.mjs';
const file=new URL('../templates/onboarding-form.json',import.meta.url);
const text=JSON.stringify({version:1,title:'Onboarding client',instructions:'Aucun secret. Les réponses sont des déclarations client. La soumission crée un brief et la mission autorisée par le lien.',...ONBOARDING_SCHEMA},null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(file,'utf8')!==text)throw new Error('Stale onboarding form template');}else writeFileSync(file,text);
console.log(`Onboarding: ${ONBOARDING_SCHEMA.steps.length} steps, ${ONBOARDING_SCHEMA.requiredCount} required fields.`);
