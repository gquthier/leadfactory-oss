// One atomic onboarding submission shared by the operator and client portal.
import {newId} from './store.mjs';
import {HttpError,LIMITS} from './validate.mjs';
import {assertSubmittable} from './onboarding.mjs';
import {ONBOARDING_CHECKLIST,onboardingBrief} from './generate.mjs';
const now=()=>new Date().toISOString();
function find(items,id,label){const x=items.find(x=>x.id===id);if(!x)throw new HttpError(404,`${label} introuvable.`);return x;}
function fillIfEmpty(target,key,value,max){if(typeof value==='string'&&value.trim()&&!target[key])target[key]=value.trim().slice(0,max);}
function ensureChecklist(db, clientId) {
  const existing = new Set(db.tasks.filter((t) => t.clientId === clientId).map((t) => t.onboardingKey));
  const created = [];
  for (const item of ONBOARDING_CHECKLIST) {
    if (existing.has(item.key)) continue;
    const task = {
      id: newId(),
      clientId,
      campaignId: null,
      title: item.title,
      done: false,
      onboardingKey: item.key,
      createdAt: now(),
      updatedAt: now()
    };
    db.tasks.push(task);
    created.push(task);
  }
  return { created, skipped: ONBOARDING_CHECKLIST.length - created.length };
}

export function submitOnboarding(db,clientId){
        const client = find(db.clients, clientId, 'Client');
        if (!client.onboarding) throw new HttpError(400, 'Questionnaire non commencé : enregistrez d\'abord un brouillon.');
        const ob = client.onboarding;
        const progress = assertSubmittable(ob);

        // Réutilisation des champs client existants (sans écraser une saisie).
        fillIfEmpty(client, 'offer', ob.offer.service, LIMITS.medium);
        fillIfEmpty(client, 'audience', ob.target.profile, LIMITS.medium);
        fillIfEmpty(client, 'goal', ob.campaign.objective, LIMITS.medium);
        fillIfEmpty(client, 'contact', ob.company.contactName, LIMITS.short);
        fillIfEmpty(client, 'email', ob.company.contactEmail, LIMITS.short);
        if (!client.budget) client.budget = ob.campaign.budget;
        if (client.status === 'prospect') client.status = 'onboarding';

        // LA campagne brouillon liée : créée une seule fois, puis réutilisée.
        let campaign = ob.campaignId ? db.campaigns.find((c) => c.id === ob.campaignId && c.clientId === client.id) : null;
        if (!campaign) {
          campaign = {
            id: newId(),
            clientId: client.id,
            name: `Onboarding - ${client.company}`.slice(0, LIMITS.short),
            channel: ob.campaign.channel,
            goal: ob.campaign.objective.slice(0, LIMITS.medium),
            budget: ob.campaign.budget,
            status: 'draft',
            createdAt: now(),
            updatedAt: now()
          };
          db.campaigns.push(campaign);
          ob.campaignId = campaign.id;
        } else if (campaign.status === 'draft') {
          campaign.channel = ob.campaign.channel;
          campaign.goal = ob.campaign.objective.slice(0, LIMITS.medium);
          campaign.budget = ob.campaign.budget;
          campaign.updatedAt = now();
        }

        const tasks = ensureChecklist(db, client.id);

        ob.status = 'submitted';
        ob.submittedAt = now();
        ob.reviewedAt = null;
        ob.updatedAt = now();

        // Brief local (modèle déterministe), lié au client et à la campagne.
        const content = onboardingBrief(client);
        let brief = ob.briefId ? db.deliverables.find((d) => d.id === ob.briefId && d.clientId === client.id) : null;
        if (!brief) {
          brief = {
            id: newId(),
            clientId: client.id,
            campaignId: campaign.id,
            type: 'brief',
            title: 'Brief onboarding (questionnaire)',
            content,
            generated: true,
            source: 'template',
            model: null,
            generatedAt: null,
            createdAt: now(),
            updatedAt: now()
          };
          db.deliverables.push(brief);
          ob.briefId = brief.id;
        } else {
          brief.content = content;
          brief.updatedAt = now();
        }
        client.updatedAt = now();
        return { onboarding: ob, progress, campaign, brief, tasks, client };
}
