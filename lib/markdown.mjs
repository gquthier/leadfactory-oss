// Export Markdown d'un dossier client, destine à être lu par un humain ou un agent.

import { onboardingProgress, onboardingSummaryLines } from './onboarding.mjs';

const ONBOARDING_STATUS_LABEL = { draft: 'brouillon', submitted: 'soumis', reviewed: 'revu' };

function value(v, alt = 'non renseigné') {
  const raw = typeof v === 'string' ? v.trim() : '';
  return raw === '' ? alt : raw;
}

export function clientDossier(db, clientId) {
  const client = db.clients.find((c) => c.id === clientId);
  if (!client) return null;

  const campaigns = db.campaigns.filter((c) => c.clientId === clientId);
  const tasks = db.tasks.filter((t) => t.clientId === clientId);
  const deliverables = db.deliverables.filter((d) => d.clientId === clientId);
  const campaignName = (id) => campaigns.find((c) => c.id === id)?.name ?? 'campagne inconnue';

  const out = [];
  out.push(`# Dossier client : ${client.company}`);
  out.push('');
  out.push('Document généré localement depuis les données saisies. Aucun résultat commercial n\'est estimé ici.');
  out.push('');
  out.push('## Fiche');
  out.push(`- Contact : ${value(client.contact)}`);
  out.push(`- Email : ${value(client.email)}`);
  out.push(`- Statut : ${client.status}`);
  out.push(`- Offre : ${value(client.offer)}`);
  out.push(`- Audience : ${value(client.audience)}`);
  out.push(`- Objectif : ${value(client.goal)}`);
  out.push(`- Budget : ${client.budget} EUR`);
  out.push(`- Notes : ${value(client.notes, 'aucune')}`);
  out.push('');

  if (client.onboarding) {
    const progress = onboardingProgress(client.onboarding);
    out.push(`## Questionnaire d'onboarding (${ONBOARDING_STATUS_LABEL[client.onboarding.status]}, ${progress.filled}/${progress.total} champs requis)`);
    if (client.onboarding.submittedAt) out.push(`Soumis le ${client.onboarding.submittedAt}${client.onboarding.reviewedAt ? `, revu le ${client.onboarding.reviewedAt}` : ''}.`);
    out.push('');
    const lines = onboardingSummaryLines(client.onboarding);
    out.push(...(lines.length === 0 ? ['Aucune réponse saisie.', ''] : lines));
  } else {
    out.push('## Questionnaire d\'onboarding');
    out.push('Non commencé.');
    out.push('');
  }

  out.push(`## Campagnes (${campaigns.length})`);
  if (campaigns.length === 0) {
    out.push('Aucune campagne.');
  } else {
    for (const c of campaigns) {
      out.push(`- **${c.name}** — canal ${c.channel}, statut ${c.status}, budget ${c.budget} EUR`);
      if (c.goal) out.push(`  - Objectif : ${c.goal}`);
    }
  }
  out.push('');

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  out.push(`## Tâches (${done.length}/${tasks.length} terminées)`);
  if (tasks.length === 0) {
    out.push('Aucune tâche.');
  } else {
    for (const t of [...open, ...done]) {
      const scope = t.campaignId ? ` _(${campaignName(t.campaignId)})_` : '';
      out.push(`- [${t.done ? 'x' : ' '}] ${t.title}${scope}`);
    }
  }
  out.push('');

  out.push(`## Livrables (${deliverables.length})`);
  if (deliverables.length === 0) {
    out.push('Aucun livrable.');
  } else {
    for (const d of deliverables) {
      const scope = d.campaignId ? ` — ${campaignName(d.campaignId)}` : '';
      out.push('');
      out.push(`### ${d.title} (${d.type})${scope}`);
      if (d.source === 'ai') out.push(`_Rédigé par IA via OpenRouter (modèle ${d.model}, le ${d.generatedAt ?? d.createdAt}) : à vérifier avant usage._`);
      else if (d.source === 'template' || d.generated) out.push('_Modèle prérempli généré localement, à relire._');
      out.push('');
      out.push(value(d.content, '(vide)'));
    }
  }
  out.push('');
  return out.join('\n');
}
