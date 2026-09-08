// Questionnaire d'onboarding : brouillon, reprise, soumission, idempotence, export/import, profil d'agence.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient, request, startServer } from './harness.mjs';

const FULL_ANSWERS = {
  company: { website: 'https://exemple.example', contactName: 'Nadia Test', contactEmail: 'nadia@example.com' },
  offer: { service: 'Audit énergétique', problem: 'Factures trop élevées', promise: 'Un plan chiffré sous 10 jours', proofs: 'Témoignage de la société Fictive SAS (2025)' },
  target: { profile: 'PME industrielles 20-200 salariés', zone: 'Hauts-de-France', exclusions: 'Pas de particuliers, pas de secteur public' },
  campaign: { channel: 'meta', objective: '15 rendez-vous qualifiés', qualifiedLead: 'Décideur, site > 500 m², projet sous 6 mois', kpi: 'Coût par RDV tenu', budget: 1500 },
  delivery: { accessGranted: true, accessNotes: 'Invitation Business Manager envoyée', validator: 'Nadia' }
};

test('le schéma du questionnaire est servi et liste les champs requis', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const res = await request(app.port, '/api/onboarding/schema');
  assert.equal(res.status, 200);
  assert.equal(res.body.steps.length, 5);
  assert.deepEqual(
    res.body.steps.map((s) => s.key),
    ['company', 'offer', 'target', 'campaign', 'delivery']
  );
  const required = res.body.steps.flatMap((s) => s.fields.filter((f) => f.required).map((f) => `${s.key}.${f.name}`));
  assert.equal(required.length, res.body.requiredCount);
  for (const key of ['offer.service', 'offer.problem', 'offer.promise', 'target.profile', 'target.exclusions', 'campaign.objective', 'campaign.qualifiedLead', 'campaign.kpi', 'campaign.budget', 'campaign.channel']) {
    assert.ok(required.includes(key), `${key} doit être requis`);
  }
});

test('brouillon : création partielle, reprise à la bonne étape, progression factuelle', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port);

  const before = await request(app.port, `/api/clients/${client.id}/onboarding`);
  assert.equal(before.status, 200);
  assert.equal(before.body.started, false);
  assert.equal(before.body.progress.filled, 0);

  const draft = await request(app.port, `/api/clients/${client.id}/onboarding`, {
    method: 'PUT',
    body: { offer: { service: 'Audit', problem: 'Coûts' }, step: 1 }
  });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.onboarding.status, 'draft');
  assert.equal(draft.body.onboarding.step, 1);
  assert.equal(draft.body.progress.filled, 2);
  assert.equal(draft.body.progress.complete, false);
  assert.ok(draft.body.progress.missing.some((m) => m.field === 'campaign.budget'));

  // Reprise après redémarrage : les réponses et l'étape sont conservées.
  await app.close();
  const again = await startServer(app.dataDir);
  t.after(() => again.close());
  const resumed = await request(again.port, `/api/clients/${client.id}/onboarding`);
  assert.equal(resumed.body.started, true);
  assert.equal(resumed.body.onboarding.offer.service, 'Audit');
  assert.equal(resumed.body.onboarding.offer.problem, 'Coûts');
  assert.equal(resumed.body.onboarding.step, 1);

  // Une section fournie plus tard fait avancer l'étape sans effacer le reste.
  const more = await request(again.port, `/api/clients/${client.id}/onboarding`, {
    method: 'PUT',
    body: { target: { profile: 'PME' } }
  });
  assert.equal(more.body.onboarding.offer.service, 'Audit');
  assert.equal(more.body.onboarding.step, 2);

  // Validation de type même en brouillon.
  const badUrl = await request(again.port, `/api/clients/${client.id}/onboarding`, {
    method: 'PUT',
    body: { company: { website: 'pas une url' } }
  });
  assert.equal(badUrl.status, 400);
  assert.equal(badUrl.body.field, 'company.website');
  const badChannel = await request(again.port, `/api/clients/${client.id}/onboarding`, {
    method: 'PUT',
    body: { campaign: { channel: 'tiktok' } }
  });
  assert.equal(badChannel.status, 400);

  // Les champs internes ne sont pas pilotables depuis le corps.
  const forged = await request(again.port, `/api/clients/${client.id}/onboarding`, {
    method: 'PUT',
    body: { status: 'reviewed', campaignId: 'x', offer: { price: '1000 €' } }
  });
  assert.equal(forged.status, 200);
  assert.equal(forged.body.onboarding.status, 'draft');
  assert.equal(forged.body.onboarding.campaignId, null);
});

test('soumission : refus si incomplet, puis création idempotente campagne + checklist + brief', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port, { company: 'Soumission SARL', offer: '', audience: '', goal: '', budget: 0, contact: '', email: '' });

  const notStarted = await request(app.port, `/api/clients/${client.id}/onboarding/submit`, { method: 'POST' });
  assert.equal(notStarted.status, 400);

  await request(app.port, `/api/clients/${client.id}/onboarding`, {
    method: 'PUT',
    body: { ...FULL_ANSWERS, campaign: { ...FULL_ANSWERS.campaign, budget: null } }
  });
  const incomplete = await request(app.port, `/api/clients/${client.id}/onboarding/submit`, { method: 'POST' });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.body.field, 'campaign.budget');
  let state = (await request(app.port, '/api/state')).body;
  assert.equal(state.campaigns.length, 0, 'aucune campagne sur soumission refusée');
  assert.equal(state.deliverables.length, 0);
  assert.equal(state.clients[0].onboarding.status, 'draft');

  await request(app.port, `/api/clients/${client.id}/onboarding`, { method: 'PUT', body: { campaign: { budget: '1500' } } });
  const submitted = await request(app.port, `/api/clients/${client.id}/onboarding/submit`, { method: 'POST' });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.onboarding.status, 'submitted');
  assert.ok(submitted.body.onboarding.submittedAt);
  assert.equal(submitted.body.campaign.clientId, client.id);
  assert.equal(submitted.body.campaign.channel, 'meta');
  assert.equal(submitted.body.campaign.status, 'draft');
  assert.equal(submitted.body.campaign.budget, 1500);
  assert.equal(submitted.body.onboarding.campaignId, submitted.body.campaign.id);
  assert.equal(submitted.body.brief.clientId, client.id);
  assert.equal(submitted.body.brief.campaignId, submitted.body.campaign.id);
  assert.equal(submitted.body.brief.source, 'template');
  assert.match(submitted.body.brief.content, /Témoignage de la société Fictive SAS/);
  assert.ok(submitted.body.tasks.created.length >= 5);

  // Champs client réutilisés (remplis seulement s'ils étaient vides).
  state = (await request(app.port, '/api/state')).body;
  const saved = state.clients[0];
  assert.equal(saved.offer, 'Audit énergétique');
  assert.equal(saved.audience, 'PME industrielles 20-200 salariés');
  assert.equal(saved.budget, 1500);
  assert.equal(saved.contact, 'Nadia Test');
  assert.equal(saved.status, 'onboarding');

  // Seconde soumission : aucune duplication.
  const again = await request(app.port, `/api/clients/${client.id}/onboarding/submit`, { method: 'POST' });
  assert.equal(again.status, 200);
  assert.equal(again.body.campaign.id, submitted.body.campaign.id);
  assert.equal(again.body.brief.id, submitted.body.brief.id);
  assert.equal(again.body.tasks.created.length, 0);
  state = (await request(app.port, '/api/state')).body;
  assert.equal(state.campaigns.length, 1);
  assert.equal(state.deliverables.length, 1);
  assert.equal(state.tasks.length, submitted.body.tasks.created.length);

  // Revue explicite, puis édition => retour en brouillon et nouvelle validation.
  const review = await request(app.port, `/api/clients/${client.id}/onboarding/review`, { method: 'POST' });
  assert.equal(review.status, 200);
  assert.equal(review.body.onboarding.status, 'reviewed');
  const reviewTwice = await request(app.port, `/api/clients/${client.id}/onboarding/review`, { method: 'POST' });
  assert.equal(reviewTwice.status, 409);

  const untouched = await request(app.port, `/api/clients/${client.id}/onboarding`, { method: 'PUT', body: { step: 4 } });
  assert.equal(untouched.body.onboarding.status, 'reviewed', 'changer d’étape sans modifier le contenu ne réinitialise pas');
  const edited = await request(app.port, `/api/clients/${client.id}/onboarding`, {
    method: 'PUT',
    body: { campaign: { kpi: 'Coût par lead qualifié' } }
  });
  assert.equal(edited.body.statusReset, true);
  assert.equal(edited.body.onboarding.status, 'draft');
  assert.equal(edited.body.onboarding.campaignId, submitted.body.campaign.id, 'le lien campagne survit à la réédition');

  const resubmitted = await request(app.port, `/api/clients/${client.id}/onboarding/submit`, { method: 'POST' });
  assert.equal(resubmitted.status, 200);
  assert.equal(resubmitted.body.campaign.id, submitted.body.campaign.id);
  assert.equal((await request(app.port, '/api/state')).body.campaigns.length, 1);

  // Supprimer la campagne liée détache le questionnaire ; la resoumission en recrée une seule.
  await request(app.port, `/api/campaigns/${submitted.body.campaign.id}`, { method: 'DELETE' });
  state = (await request(app.port, '/api/state')).body;
  assert.equal(state.clients[0].onboarding.campaignId, null);
  const recreated = await request(app.port, `/api/clients/${client.id}/onboarding/submit`, { method: 'POST' });
  assert.notEqual(recreated.body.campaign.id, submitted.body.campaign.id);
  assert.equal((await request(app.port, '/api/state')).body.campaigns.length, 1);

  // Le dossier Markdown reflète le questionnaire.
  const md = await request(app.port, `/api/clients/${client.id}/dossier.md`);
  assert.match(md.text, /Questionnaire d'onboarding \(soumis/);
  assert.match(md.text, /Définition d’un lead qualifié : Décideur/);
});

test('le questionnaire et le profil d’agence survivent à un export/import intégral', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const client = await createClient(app.port, { company: 'Export Onboarding' });
  await request(app.port, `/api/clients/${client.id}/onboarding`, { method: 'PUT', body: FULL_ANSWERS });
  await request(app.port, `/api/clients/${client.id}/onboarding/submit`, { method: 'POST' });
  const agency = await request(app.port, '/api/agency', {
    method: 'PUT',
    body: { name: 'Agence Fictive', offer: 'Lead gen B2B', audience: 'PME', language: 'fr', contact: 'Gaston', email: 'gaston@example.com', tools: { assistant: 'codex', skillsInstalled: true } }
  });
  assert.equal(agency.status, 200);
  assert.equal(agency.body.name, 'Agence Fictive');
  assert.ok(agency.body.updatedAt);

  const snapshot = JSON.parse((await request(app.port, '/api/export')).text);
  assert.equal(snapshot.agency.name, 'Agence Fictive');
  assert.equal(snapshot.clients[0].onboarding.status, 'submitted');

  const other = await startServer();
  t.after(() => other.close());
  const imported = await request(other.port, '/api/import', { method: 'POST', body: snapshot });
  assert.equal(imported.status, 200);
  assert.deepEqual((await request(other.port, '/api/state')).body, snapshot);
  const resumed = await request(other.port, `/api/clients/${client.id}/onboarding`);
  assert.equal(resumed.body.onboarding.campaignId, snapshot.campaigns[0].id);
  assert.equal(resumed.body.progress.complete, true);

  // Un import dont le lien campagne est incohérent est refusé.
  const broken = structuredClone(snapshot);
  broken.clients[0].onboarding.campaignId = 'inexistante';
  const rejected = await request(other.port, '/api/import', { method: 'POST', body: broken });
  assert.equal(rejected.status, 400);

  // Un ancien export sans champ agency conserve le profil courant.
  const legacy = structuredClone(snapshot);
  delete legacy.agency;
  legacy.clients[0].onboarding = undefined;
  const legacyImport = await request(other.port, '/api/import', { method: 'POST', body: legacy });
  assert.equal(legacyImport.status, 200);
  const after = (await request(other.port, '/api/state')).body;
  assert.equal(after.agency.name, 'Agence Fictive');
  assert.equal(after.clients[0].onboarding, null);
});

test('le profil d’agence est validé et jamais considéré configuré par défaut', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const initial = (await request(app.port, '/api/agency')).body;
  assert.equal(initial.name, '');
  assert.equal(initial.updatedAt, null);

  const badEmail = await request(app.port, '/api/agency', { method: 'PUT', body: { name: 'X', email: 'nope' } });
  assert.equal(badEmail.status, 400);
  const badLang = await request(app.port, '/api/agency', { method: 'PUT', body: { name: 'X', language: 'de' } });
  assert.equal(badLang.status, 400);

  const partial = await request(app.port, '/api/agency', { method: 'PUT', body: { name: 'Mon agence' } });
  assert.equal(partial.status, 200);
  const merged = await request(app.port, '/api/agency', { method: 'PUT', body: { offer: 'Cold email' } });
  assert.equal(merged.body.name, 'Mon agence');
  assert.equal(merged.body.offer, 'Cold email');
  assert.equal(merged.body.tools.skillsInstalled, false);
});
