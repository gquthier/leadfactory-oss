// Interface locale — rendu 100 % via createElement/textContent (jamais innerHTML
// avec des données saisies), donc aucun HTML utilisateur n'est interprété.

const CLIENT_STATUS = ['prospect', 'onboarding', 'actif', 'pause', 'termine'];
const CLIENT_STATUS_LABEL = {
  prospect: 'Prospect',
  onboarding: 'Onboarding',
  actif: 'Actif',
  pause: 'En pause',
  termine: 'Terminé'
};
const CHANNELS = ['cold-email', 'meta', 'google', 'organic'];
const CHANNEL_LABEL = {
  'cold-email': 'Cold email',
  meta: 'Meta Ads',
  google: 'Google Ads',
  organic: 'Organique'
};
const CAMPAIGN_STATUS = ['draft', 'ready', 'active', 'paused', 'done'];
const CAMPAIGN_STATUS_LABEL = {
  draft: 'Brouillon',
  ready: 'Prête',
  active: 'Active',
  paused: 'En pause',
  done: 'Terminée'
};
const DELIVERABLE_TYPES = ['brief', 'cold-email', 'creative-brief', 'report'];
const DELIVERABLE_LABEL = {
  brief: 'Brief',
  'cold-email': 'Cold email',
  'creative-brief': 'Brief créatif',
  report: 'Rapport'
};

const SOURCE_LABEL = { manual: 'Saisie manuelle', template: 'Modèle prérempli', ai: 'Rédigé par IA' };
const ONBOARDING_STATUS_LABEL = { draft: 'Brouillon', submitted: 'Soumis', reviewed: 'Revu' };
const KEY_STATUS_LABEL = {
  unconfigured: 'Non configurée',
  configured: 'Configurée, non testée',
  verified: 'Vérifiée',
  error: 'Erreur'
};
const SKILLS_CATALOG_URL = 'https://github.com/gquthier/leadfactory-oss/blob/main/docs/SKILLS.md';
const OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys';

const state = {
  db: { agency: {}, clients: [], campaigns: [], tasks: [], deliverables: [] },
  connections: { openrouter: { configured: false, model: '', status: 'unconfigured', verifiedAt: null, lastError: null } },
  schema: null,
  hostedBy: null,
  view: 'start',
  clientId: null,
  onboarding: null, // { onboarding, progress, started } du client ouvert
  onboardingStep: 0,
  search: '',
  clientStatus: '',
  campaignClient: '',
  campaignStatus: '',
  taskClient: '',
  hideDoneTasks: false,
  deliverableClient: ''
};

// Synchronisation avec les autres écrivains (agents locaux, second onglet).
let live = null;
// Révision lue AVANT les données actuellement chargées ; adoptée par render().
let pendingAdopt = null;
const liveUi = { notice: false, online: true };

const NAV = [
  { id: 'start', label: 'Start Here' },
  { id: 'dashboard', label: 'Tableau de bord' },
  { id: 'clients', label: 'Clients' },
  { id: 'campaigns', label: 'Campagnes' },
  { id: 'tasks', label: 'Tâches' },
  { id: 'deliverables', label: 'Livrables' },
  { id: 'data', label: 'Données' }
];

// --- Petits utilitaires DOM ---------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function badge(value, label) {
  return el('span', { class: `badge ${value}`, text: label ?? value });
}

function euros(value) {
  return `${Number(value ?? 0).toLocaleString('fr-FR')} €`;
}

let toastTimer = null;
function toast(message, kind = 'info') {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.dataset.kind = kind;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 4200);
}

const SAVE_LABEL = { idle: 'Prêt', saving: 'Enregistrement…', saved: 'Enregistré ✓', error: 'Échec de l’enregistrement' };
function setSave(kind) {
  const node = document.getElementById('save-state');
  node.dataset.state = kind;
  node.textContent = SAVE_LABEL[kind];
}

// --- Accès API ------------------------------------------------------------

async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (method !== 'GET') {
    setSave('saving');
    // Une écriture locale invalide tout cycle de synchronisation déjà démarré :
    // ses données seraient périmées et produiraient un faux avis.
    live?.invalidate();
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    if (method !== 'GET') setSave('error');
    throw new Error('Serveur injoignable. Vérifiez que « npm start » tourne toujours.');
  }
  const raw = await res.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    if (method !== 'GET') setSave('error');
    throw new Error(data?.error ?? `Erreur ${res.status}`);
  }
  if (method !== 'GET') setSave('saved');
  return data;
}

async function refresh() {
  // Révision d'abord, données ensuite : l'état chargé est donc au moins aussi
  // récent que la révision retenue. Jamais l'inverse, sinon un changement
  // survenu entre les deux requêtes passerait inaperçu.
  const key = live ? await live.readKey() : null;
  state.db = await api('/api/state');
  if (state.view === 'onboarding' && state.clientId) {
    state.onboarding = await api(`/api/clients/${state.clientId}/onboarding`);
  }
  pendingAdopt = key;
}

async function refreshConnections() {
  state.connections = await api('/api/connections');
}

function agencyConfigured() {
  return typeof state.db.agency?.name === 'string' && state.db.agency.name.trim() !== '';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copié dans le presse-papiers.');
  } catch {
    toast('Copie impossible : sélectionnez le texte manuellement.', 'error');
  }
}

/** Enveloppe les actions : rafraîchit, redessine, affiche l'erreur éventuelle. */
async function run(action, successMessage) {
  try {
    const result = await action();
    await refresh();
    render();
    if (successMessage) toast(successMessage);
    return result;
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

// --- Synchronisation avec les autres écrivains ----------------------------

// Garde de saisie fournie par live-refresh.js (voir startLive).
let inputGuard = null;
let isTypingIn = () => false;

/**
 * Vrai quand recharger écraserait quelque chose : fenêtre modale ouverte,
 * questionnaire d'onboarding ouvert, curseur dans un champ de saisie, ou
 * brouillon modifié (éditeurs en ligne de Start Here compris).
 */
function wouldOverwriteInput() {
  if (document.getElementById('dialog')?.open) return true;
  if (state.view === 'onboarding') return true;
  if (isTypingIn(document.activeElement)) return true;
  return Boolean(inputGuard?.isDirty(document.getElementById('view')));
}

// --- Bandeau discret : avis de données modifiées et état de la connexion ---

let liveBarNodes = null;
function liveBar() {
  if (liveBarNodes && liveBarNodes.root.isConnected) return liveBarNodes;
  const text = el('span', { class: 'live-text' });
  const action = el('button', { class: 'btn small', type: 'button' });
  const root = el('div', { id: 'lf-live', class: 'live-bar', hidden: true, role: 'status' }, [text, action]);
  document.body.append(root);
  liveBarNodes = { root, text, action };
  return liveBarNodes;
}

function renderLiveBar() {
  const { root, text, action } = liveBar();
  const setAction = (label, handler) => {
    action.textContent = label;
    action.onclick = handler;
    action.hidden = false;
  };
  if (!liveUi.online) {
    text.textContent = 'Serveur local injoignable. Nouvelle tentative automatique.';
    root.dataset.kind = 'offline';
    setAction('Réessayer', () => live?.wake());
    root.hidden = false;
    return;
  }
  if (liveUi.notice) {
    text.textContent = 'Données modifiées ailleurs. Votre saisie en cours est conservée.';
    root.dataset.kind = 'notice';
    setAction('Recharger', () => live?.reloadNow());
    root.hidden = false;
    return;
  }
  root.hidden = true;
  action.onclick = null;
}

/** Restaure la position de défilement après un rendu complet. */
function withScroll(fn) {
  const y = window.scrollY;
  fn();
  if (window.scrollY !== y) window.scrollTo(0, y);
}

/** Applique un état venu du serveur sans perdre vue, filtres ni sélection. */
async function applyRemoteState(db) {
  state.db = db;
  let message = null;
  const consulted = (state.view === 'client' || state.view === 'onboarding') && state.clientId;
  if (consulted && !db.clients.some((c) => c.id === state.clientId)) {
    state.view = 'clients';
    state.clientId = null;
    state.onboarding = null;
    message = 'Le client consulté a été supprimé ailleurs : retour à la liste des clients.';
  } else if (state.view === 'onboarding' && state.clientId) {
    try {
      state.onboarding = await api(`/api/clients/${state.clientId}/onboarding`);
    } catch {
      // Questionnaire devenu illisible : on retombe sur le dossier client.
      state.view = 'client';
      state.onboarding = null;
    }
  }
  withScroll(() => render());
  if (message) toast(message);
}

async function startLive() {
  // Import dynamique : app.js reste par ailleurs un script classique valide.
  const module = await import('./live-refresh.js');
  const { createLiveRefresh } = module;
  inputGuard = module.createInputGuard();
  isTypingIn = module.isTypingIn;
  live = createLiveRefresh({
    readMeta: async () => {
      const meta = await api('/api/meta');
      state.hostedBy = meta.hostedBy === 'bizos-local' ? meta.hostedBy : null;
      return meta;
    },
    readState: () => api('/api/state'),
    applyState: applyRemoteState,
    isBusy: wouldOverwriteInput,
    onNotice: (notice) => {
      liveUi.notice = notice !== null;
      renderLiveBar();
    },
    onStatus: ({ online }) => {
      liveUi.online = online;
      renderLiveBar();
    }
  });
  document.addEventListener('visibilitychange', () => live.setVisible(!document.hidden));
  window.addEventListener('focus', () => live.wake());
  live.setVisible(!document.hidden);
  live.start();
}

// --- Dialogues -----------------------------------------------------------

function closeDialog() {
  const dialog = document.getElementById('dialog');
  dialog.close();
  dialog.replaceChildren();
}

function openConfirm({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  const dialog = document.getElementById('dialog');
  return new Promise((resolve) => {
    const body = el('div', { class: 'dialog-body' }, [
      el('h2', { text: title }),
      el('p', { text: message }),
      el('div', { class: 'dialog-foot' }, [
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Annuler',
          onclick: () => {
            closeDialog();
            resolve(false);
          }
        }),
        el('button', {
          class: `btn ${danger ? 'danger' : 'primary'}`,
          type: 'button',
          text: confirmLabel,
          onclick: () => {
            closeDialog();
            resolve(true);
          }
        })
      ])
    ]);
    dialog.replaceChildren(body);
    dialog.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault();
        closeDialog();
        resolve(false);
      },
      { once: true }
    );
    dialog.showModal();
  });
}

/**
 * Formulaire générique. `onSubmit` peut lever : le message s'affiche dans la
 * fenêtre et la saisie est conservée.
 */
function openForm({ title, intro, fields, values = {}, submitLabel = 'Enregistrer', onSubmit }) {
  const dialog = document.getElementById('dialog');
  const inputs = new Map();
  const errorNode = el('p', { class: 'dialog-error' });
  const form = el('form', { class: 'dialog-body', novalidate: true });

  form.append(el('h2', { text: title }));
  if (intro) form.append(el('p', { class: 'subtitle', text: intro }));

  for (const field of fields) {
    const id = `f-${field.name}`;
    let input;
    if (field.type === 'textarea') {
      input = el('textarea', { id, rows: field.rows ?? 5, value: values[field.name] ?? '' });
    } else if (field.type === 'select') {
      input = el(
        'select',
        { id },
        field.options.map((opt) =>
          el('option', {
            value: opt.value,
            text: opt.label,
            selected: String(values[field.name] ?? '') === String(opt.value)
          })
        )
      );
    } else {
      input = el('input', {
        id,
        type: field.type ?? 'text',
        value: values[field.name] ?? '',
        step: field.type === 'number' ? '0.01' : undefined,
        min: field.type === 'number' ? '0' : undefined,
        placeholder: field.placeholder ?? '',
        autocomplete: field.type === 'password' ? 'off' : undefined
      });
    }
    inputs.set(field.name, input);
    form.append(
      el('div', { class: 'field' }, [
        el('label', { for: id, text: field.required ? `${field.label} *` : field.label }),
        input,
        field.hint ? el('span', { class: 'hint', text: field.hint }) : null
      ])
    );
  }

  const submitBtn = el('button', { class: 'btn primary', type: 'submit', text: submitLabel });
  form.append(errorNode);
  form.append(
    el('div', { class: 'dialog-foot' }, [
      el('button', { class: 'btn', type: 'button', text: 'Annuler', onclick: () => closeDialog() }),
      submitBtn
    ])
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorNode.textContent = '';
    submitBtn.disabled = true;
    const payload = {};
    for (const [name, input] of inputs) payload[name] = input.value;
    try {
      await onSubmit(payload);
      closeDialog();
    } catch (err) {
      errorNode.textContent = err.message;
      submitBtn.disabled = false;
    }
  });

  dialog.replaceChildren(form);
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      closeDialog();
    },
    { once: true }
  );
  dialog.showModal();
  inputs.values().next().value?.focus();
}

// --- Champs réutilisés ----------------------------------------------------

const clientFields = () => [
  { name: 'company', label: 'Nom de l’entreprise', required: true },
  { name: 'contact', label: 'Contact' },
  { name: 'email', label: 'Email (facultatif)', type: 'email' },
  { name: 'offer', label: 'Offre' },
  { name: 'audience', label: 'Audience cible' },
  { name: 'goal', label: 'Objectif' },
  { name: 'budget', label: 'Budget mensuel (€)', type: 'number' },
  {
    name: 'status',
    label: 'Statut',
    type: 'select',
    options: CLIENT_STATUS.map((s) => ({ value: s, label: CLIENT_STATUS_LABEL[s] }))
  },
  { name: 'notes', label: 'Notes', type: 'textarea' }
];

const clientOptions = (withEmpty = false) => [
  ...(withEmpty ? [{ value: '', label: '— Aucun —' }] : []),
  ...state.db.clients.map((c) => ({ value: c.id, label: c.company }))
];

// Sans client présélectionné, on préfixe par le nom du client pour lever l'ambiguïté.
const campaignOptions = (clientId) => [
  { value: '', label: '— Aucune campagne —' },
  ...state.db.campaigns
    .filter((c) => !clientId || c.clientId === clientId)
    .map((c) => ({
      value: c.id,
      label: clientId ? c.name : `${state.db.clients.find((x) => x.id === c.clientId)?.company ?? '?'} — ${c.name}`
    }))
];

const campaignFields = (clientId) => [
  { name: 'clientId', label: 'Client', type: 'select', required: true, options: clientOptions() },
  { name: 'name', label: 'Nom de la campagne', required: true },
  {
    name: 'channel',
    label: 'Canal',
    type: 'select',
    required: true,
    options: CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))
  },
  { name: 'goal', label: 'Objectif' },
  { name: 'budget', label: 'Budget (€)', type: 'number' },
  {
    name: 'status',
    label: 'Statut',
    type: 'select',
    options: CAMPAIGN_STATUS.map((s) => ({ value: s, label: CAMPAIGN_STATUS_LABEL[s] }))
  }
];

// --- Actions --------------------------------------------------------------

function newClient({ thenOnboarding = false } = {}) {
  openForm({
    title: 'Nouveau client',
    intro: thenOnboarding ? 'Le questionnaire d’onboarding s’ouvrira juste après.' : undefined,
    fields: clientFields(),
    values: { status: 'prospect' },
    onSubmit: async (values) => {
      const created = await run(() => api('/api/clients', { method: 'POST', body: values }), 'Client créé.');
      if (thenOnboarding && created?.id) await openOnboarding(created.id);
    }
  });
}

function editClient(client) {
  openForm({
    title: `Modifier ${client.company}`,
    fields: clientFields(),
    values: client,
    onSubmit: (values) =>
      run(() => api(`/api/clients/${client.id}`, { method: 'PATCH', body: values }), 'Client mis à jour.')
  });
}

async function deleteClient(client) {
  const ok = await openConfirm({
    title: 'Supprimer ce client ?',
    message: `« ${client.company} » et ses campagnes, tâches et livrables seront supprimés définitivement.`,
    confirmLabel: 'Supprimer',
    danger: true
  });
  if (!ok) return;
  if (state.clientId === client.id) {
    state.view = 'clients';
    state.clientId = null;
  }
  await run(() => api(`/api/clients/${client.id}`, { method: 'DELETE' }), 'Client supprimé.');
}

function newCampaign(clientId = '') {
  openForm({
    title: 'Nouvelle campagne',
    fields: campaignFields(),
    values: { clientId, status: 'draft', channel: 'cold-email' },
    onSubmit: (values) => run(() => api('/api/campaigns', { method: 'POST', body: values }), 'Campagne créée.')
  });
}

function editCampaign(campaign) {
  openForm({
    title: `Modifier ${campaign.name}`,
    fields: campaignFields(),
    values: campaign,
    onSubmit: (values) =>
      run(() => api(`/api/campaigns/${campaign.id}`, { method: 'PATCH', body: values }), 'Campagne mise à jour.')
  });
}

async function deleteCampaign(campaign) {
  const ok = await openConfirm({
    title: 'Supprimer cette campagne ?',
    message: `« ${campaign.name} » sera supprimée. Les tâches et livrables associés sont conservés mais détachés.`,
    confirmLabel: 'Supprimer',
    danger: true
  });
  if (!ok) return;
  await run(() => api(`/api/campaigns/${campaign.id}`, { method: 'DELETE' }), 'Campagne supprimée.');
}

function newTask(clientId = '', campaignId = '') {
  openForm({
    title: 'Nouvelle tâche',
    fields: [
      { name: 'clientId', label: 'Client', type: 'select', required: true, options: clientOptions() },
      { name: 'campaignId', label: 'Campagne (facultatif)', type: 'select', options: campaignOptions(clientId) },
      { name: 'title', label: 'Intitulé', required: true }
    ],
    values: { clientId, campaignId },
    onSubmit: (values) => run(() => api('/api/tasks', { method: 'POST', body: values }), 'Tâche ajoutée.')
  });
}

function toggleTask(task, done) {
  return run(() => api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { done } }));
}

async function deleteTask(task) {
  const ok = await openConfirm({
    title: 'Supprimer cette tâche ?',
    message: task.title,
    confirmLabel: 'Supprimer',
    danger: true
  });
  if (!ok) return;
  await run(() => api(`/api/tasks/${task.id}`, { method: 'DELETE' }), 'Tâche supprimée.');
}

function newDeliverable(clientId = '', campaignId = '') {
  openForm({
    title: 'Nouveau livrable',
    fields: [
      { name: 'clientId', label: 'Client', type: 'select', required: true, options: clientOptions() },
      { name: 'campaignId', label: 'Campagne (facultatif)', type: 'select', options: campaignOptions(clientId) },
      {
        name: 'type',
        label: 'Type',
        type: 'select',
        required: true,
        options: DELIVERABLE_TYPES.map((t) => ({ value: t, label: DELIVERABLE_LABEL[t] }))
      },
      { name: 'title', label: 'Titre', required: true },
      { name: 'content', label: 'Contenu', type: 'textarea', rows: 12 }
    ],
    values: { clientId, campaignId, type: 'brief' },
    onSubmit: (values) => run(() => api('/api/deliverables', { method: 'POST', body: values }), 'Livrable créé.')
  });
}

function deliverableIntro(item) {
  if (item.source === 'ai') return `Texte rédigé par IA via OpenRouter (modèle ${item.model}, le ${formatDate(item.generatedAt)}) : à vérifier avant usage.`;
  if (item.source === 'template' || item.generated) return 'Modèle prérempli généré localement : à relire et adapter.';
  return undefined;
}

function editDeliverable(item) {
  openForm({
    title: 'Modifier le livrable',
    intro: deliverableIntro(item),
    fields: [
      { name: 'title', label: 'Titre', required: true },
      {
        name: 'type',
        label: 'Type',
        type: 'select',
        options: DELIVERABLE_TYPES.map((t) => ({ value: t, label: DELIVERABLE_LABEL[t] }))
      },
      { name: 'content', label: 'Contenu', type: 'textarea', rows: 16 }
    ],
    values: item,
    onSubmit: (values) =>
      run(() => api(`/api/deliverables/${item.id}`, { method: 'PATCH', body: values }), 'Livrable enregistré.')
  });
}

async function deleteDeliverable(item) {
  const ok = await openConfirm({
    title: 'Supprimer ce livrable ?',
    message: item.title,
    confirmLabel: 'Supprimer',
    danger: true
  });
  if (!ok) return;
  await run(() => api(`/api/deliverables/${item.id}`, { method: 'DELETE' }), 'Livrable supprimé.');
}

async function generate(kind, clientId, campaignId) {
  await run(
    () => api('/api/generate', { method: 'POST', body: { kind, clientId, campaignId: campaignId || null } }),
    'Modèle prérempli ajouté aux livrables (aucune IA, aucun envoi).'
  );
}

async function runOnboarding(client) {
  const result = await run(() => api(`/api/clients/${client.id}/onboarding`, { method: 'POST' }));
  toast(
    result.created.length === 0
      ? 'Checklist déjà en place : aucune tâche ajoutée.'
      : `${result.created.length} tâche(s) d’onboarding ajoutée(s), ${result.skipped} déjà présente(s).`
  );
}

async function generateWithAi(kind, clientId, campaignId) {
  const client = state.db.clients.find((c) => c.id === clientId);
  const or = state.connections.openrouter;
  const ok = await openConfirm({
    title: 'Envoyer ce dossier à OpenRouter ?',
    message:
      `Les champs du client « ${client?.company ?? ''} »${campaignId ? ' et de la campagne choisie' : ''}, y compris le questionnaire d’onboarding, ` +
      `seront transmis à OpenRouter et au modèle « ${or.model} ». Cet appel peut être facturé par le fournisseur. Une seule requête, sans relance automatique.`,
    confirmLabel: 'Envoyer et rédiger'
  });
  if (!ok) return;
  toast('Envoi à OpenRouter en cours…');
  await run(
    () => api('/api/ai/generate', { method: 'POST', body: { kind, clientId, campaignId: campaignId || null } }),
    `Livrable rédigé par IA (modèle ${or.model}) ajouté : à vérifier avant usage.`
  );
}

// --- Profil d'agence et connexions ----------------------------------------

async function saveAgency(values) {
  await run(() => api('/api/agency', { method: 'PUT', body: values }), 'Profil d’agence enregistré.');
}

async function saveConnection(values) {
  const body = {};
  if (values.apiKey && values.apiKey.trim() !== '') body.apiKey = values.apiKey.trim();
  if ('model' in values) body.model = values.model.trim();
  await api('/api/connections/openrouter', { method: 'PUT', body });
  await refreshConnections();
  render();
  toast('Connexion enregistrée localement (non testée).');
}

async function testConnection() {
  toast('Test de la clé auprès d’OpenRouter…');
  try {
    await api('/api/connections/openrouter/test', { method: 'POST' });
    toast('Clé vérifiée par OpenRouter.');
  } catch (err) {
    toast(err.message, 'error');
  }
  await refreshConnections();
  render();
}

async function disconnectAi() {
  const ok = await openConfirm({
    title: 'Supprimer la connexion IA ?',
    message: 'La clé OpenRouter sera effacée du fichier local connections.json. Vous pourrez en enregistrer une autre.',
    confirmLabel: 'Supprimer la clé',
    danger: true
  });
  if (!ok) return;
  await api('/api/connections/openrouter', { method: 'DELETE' });
  await refreshConnections();
  render();
  toast('Clé supprimée.');
}

// --- Questionnaire d'onboarding -------------------------------------------

async function openOnboarding(clientId) {
  try {
    state.onboarding = await api(`/api/clients/${clientId}/onboarding`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  state.clientId = clientId;
  state.onboardingStep = state.onboarding.onboarding.step ?? 0;
  state.view = 'onboarding';
  render();
}

function collectStep(stepDef, form) {
  const section = {};
  for (const field of stepDef.fields) {
    const input = form.querySelector(`[name="${stepDef.key}.${field.name}"]`);
    if (!input) continue;
    section[field.name] = field.type === 'bool' ? input.checked : input.value;
  }
  return section;
}

async function saveOnboardingStep(clientId, stepDef, form, { silent = false } = {}) {
  const body = { [stepDef.key]: collectStep(stepDef, form), step: state.onboardingStep };
  const result = await api(`/api/clients/${clientId}/onboarding`, { method: 'PUT', body });
  state.onboarding = { onboarding: result.onboarding, progress: result.progress, started: true };
  if (result.statusReset) toast('Questionnaire modifié : il repasse en brouillon et devra être soumis à nouveau.');
  else if (!silent) toast('Brouillon enregistré.');
  return result;
}

async function submitOnboarding(clientId) {
  const result = await api(`/api/clients/${clientId}/onboarding/submit`, { method: 'POST' });
  await refresh();
  state.onboarding = { onboarding: result.onboarding, progress: result.progress, started: true };
  toast(
    `Questionnaire soumis : campagne « ${result.campaign.name} » ${result.tasks.created.length > 0 ? 'et checklist ' : ''}prêtes, brief mis à jour.`
  );
  render();
}

async function reviewOnboarding(clientId) {
  const ok = await openConfirm({
    title: 'Marquer ce questionnaire comme revu ?',
    message: 'Confirme que le brief a été relu avec le client. Toute modification ultérieure demandera une nouvelle validation.',
    confirmLabel: 'Marquer revu'
  });
  if (!ok) return;
  await run(async () => {
    const result = await api(`/api/clients/${clientId}/onboarding/review`, { method: 'POST' });
    state.onboarding = { onboarding: result.onboarding, progress: result.progress, started: true };
  }, 'Questionnaire marqué comme revu.');
}

// --- Vues -----------------------------------------------------------------

function openClient(id) {
  state.clientId = id;
  state.view = 'client';
  render();
}

function backToClientsButton() {
  return el('button', {
    class: 'btn primary',
    type: 'button',
    text: '← Liste des clients',
    onclick: () => {
      state.view = 'clients';
      state.clientId = null;
      state.onboarding = null;
      render();
    }
  });
}

function countsFor(clientId) {
  const tasks = state.db.tasks.filter((t) => t.clientId === clientId);
  return {
    campaigns: state.db.campaigns.filter((c) => c.clientId === clientId).length,
    openTasks: tasks.filter((t) => !t.done).length,
    tasks: tasks.length,
    deliverables: state.db.deliverables.filter((d) => d.clientId === clientId).length
  };
}

function pageHead(title, subtitle, actions = []) {
  return el('div', { class: 'page-head' }, [
    el('div', {}, [el('h1', { text: title }), subtitle ? el('p', { class: 'subtitle', text: subtitle }) : null]),
    el('div', { class: 'actions' }, actions)
  ]);
}

function emptyState(message) {
  return el('p', { class: 'empty', text: message });
}

function table(headers, rows) {
  return el('div', { class: 'table-wrap' }, [
    el('table', {}, [
      el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h })))]),
      el('tbody', {}, rows)
    ])
  ]);
}

// --- Start Here -------------------------------------------------------------

function inlineForm({ fields, values = {}, submitLabel, onSubmit, extraButtons = [] }) {
  const form = el('form', { class: 'stack', novalidate: true });
  const inputs = new Map();
  const errorNode = el('p', { class: 'dialog-error' });
  for (const field of fields) {
    const id = `s-${field.name}`;
    let input;
    if (field.type === 'textarea') input = el('textarea', { id, rows: field.rows ?? 3, value: values[field.name] ?? '' });
    else if (field.type === 'select') {
      input = el('select', { id }, field.options.map((o) => el('option', { value: o.value, text: o.label, selected: String(values[field.name] ?? '') === String(o.value) })));
    } else if (field.type === 'checkbox') {
      input = el('input', { id, type: 'checkbox', checked: Boolean(values[field.name]), style: 'width:auto' });
    } else {
      input = el('input', { id, type: field.type ?? 'text', value: values[field.name] ?? '', placeholder: field.placeholder ?? '', autocomplete: field.type === 'password' ? 'off' : undefined });
    }
    inputs.set(field.name, input);
    form.append(
      field.type === 'checkbox'
        ? el('label', { class: 'filters', style: 'gap:8px', for: id }, [input, field.label])
        : el('div', { class: 'field' }, [el('label', { for: id, text: field.required ? `${field.label} *` : field.label }), input, field.hint ? el('span', { class: 'hint', text: field.hint }) : null])
    );
  }
  const submitBtn = el('button', { class: 'btn primary', type: 'submit', text: submitLabel });
  form.append(errorNode, el('div', { class: 'actions' }, [submitBtn, ...extraButtons]));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorNode.textContent = '';
    submitBtn.disabled = true;
    const payload = {};
    for (const [name, input] of inputs) payload[name] = input.type === 'checkbox' ? input.checked : input.value;
    try {
      await onSubmit(payload);
    } catch (err) {
      errorNode.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
  return form;
}

function stepBadge(done, label = null) {
  return el('span', { class: `badge ${done ? 'ready' : 'draft'}`, text: label ?? (done ? 'Fait' : 'À faire') });
}

function commandBlock(command) {
  return el('div', { class: 'command' }, [
    el('code', { text: command }),
    el('button', { class: 'btn small', type: 'button', text: 'Copier', onclick: () => copyText(command) })
  ]);
}

function viewStart() {
  const agency = state.db.agency ?? {};
  const inBizos = state.hostedBy === 'bizos-local';
  const or = state.connections.openrouter;
  const profileDone = agencyConfigured();
  const aiDone = or.configured && or.model !== '';
  const skillsDeclared = Boolean(agency.tools?.skillsInstalled);
  const firstClient = state.db.clients.length > 0;
  const submitted = state.db.clients.filter((c) => c.onboarding && c.onboarding.status !== 'draft').length;

  const progress = el('div', { class: 'card' }, [
    el('h2', { text: 'Progression' }),
    el('ol', { class: 'steps' }, [
      el('li', {}, [stepBadge(profileDone), ' Profil d’agence ', el('span', { class: 'hint', text: profileDone ? `enregistré le ${formatDate(agency.updatedAt)}` : 'nom d’agence requis' })]),
      el('li', {}, [
        stepBadge(aiDone, inBizos ? 'Dans BizOS' : or.status === 'verified' ? 'Vérifiée' : aiDone ? 'Configurée' : 'À faire'),
        ' IA personnelle ',
        el('span', { class: 'hint', text: inBizos ? 'configurez votre modèle personnel dans les réglages BizOS' : aiDone ? `${KEY_STATUS_LABEL[or.status]}${or.verifiedAt ? ` le ${formatDate(or.verifiedAt)}` : ''}` : 'facultatif : les modèles préremplis fonctionnent sans IA' })
      ]),
      el('li', {}, [stepBadge(inBizos || skillsDeclared, inBizos ? 'Inclus' : skillsDeclared ? 'Déclaré installé' : 'À faire'), ' Skills LeadFactory ', el('span', { class: 'hint', text: inBizos ? 'les agents du template peuvent consulter les skills et leurs références' : 'installation déclarée par vous : le cockpit ne peut pas la vérifier' })]),
      el('li', {}, [
        stepBadge(firstClient, submitted > 0 ? 'Onboarding soumis' : firstClient ? 'Client créé' : 'À faire'),
        ' Premier client ',
        el('span', { class: 'hint', text: `${state.db.clients.length} client(s), ${submitted} questionnaire(s) soumis` })
      ])
    ])
  ]);

  const profileCard = el('div', { class: 'card stack' }, [
    el('h2', { text: '1. Profil d’agence' }),
    el('p', { class: 'subtitle', text: 'Décrit votre activité pour les briefs et les prompts IA. Inclus dans l’export JSON (Données), réimportable.' }),
    inlineForm({
      fields: [
        { name: 'name', label: 'Nom de l’agence', required: true },
        { name: 'offer', label: 'Offre principale', type: 'textarea', rows: 2 },
        { name: 'audience', label: 'Cible', type: 'textarea', rows: 2 },
        { name: 'language', label: 'Langue des livrables', type: 'select', options: [{ value: 'fr', label: 'Français' }, { value: 'en', label: 'Anglais' }] },
        { name: 'contact', label: 'Contact (nom)' },
        { name: 'email', label: 'Email (facultatif)', type: 'email' }
      ],
      values: agency,
      submitLabel: profileDone ? 'Mettre à jour le profil' : 'Enregistrer le profil',
      onSubmit: (values) => saveAgency({ ...values, tools: agency.tools })
    })
  ]);

  const statusLine = el('p', {}, [
    'Statut : ',
    el('span', { class: `badge ${or.status === 'verified' ? 'ready' : or.status === 'error' ? 'paused' : or.configured ? 'draft' : ''}`, text: KEY_STATUS_LABEL[or.status] }),
    or.verifiedAt ? ` le ${formatDate(or.verifiedAt)}` : '',
    or.model ? ` — modèle : ${or.model}` : ''
  ]);
  const aiCard = el('div', { class: 'card stack' }, [
    el('h2', { text: '2. IA personnelle (OpenRouter)' }),
    el('p', { class: 'subtitle' }, [
      'Créez votre clé sur ',
      el('a', { href: OPENROUTER_KEYS_URL, target: '_blank', rel: 'noopener noreferrer', text: 'openrouter.ai/keys' }),
      ' et indiquez l’identifiant exact du modèle (ex. openai/gpt-4o-mini). Les appels sont facturés par OpenRouter selon votre compte ; le cockpit n’appelle jamais le fournisseur sans un clic explicite.'
    ]),
    statusLine,
    or.lastError ? el('p', { class: 'note', text: `Dernier test : ${or.lastError}` }) : null,
    inlineForm({
      fields: [
        { name: 'apiKey', label: or.configured ? 'Nouvelle clé (laisser vide pour conserver la clé actuelle)' : 'Clé API OpenRouter', type: 'password', required: !or.configured, hint: 'Clé conservée sur cet ordinateur, exclue des exports clients.' },
        { name: 'model', label: 'Modèle (identifiant OpenRouter)', required: true, placeholder: 'fournisseur/modele', hint: 'Le test de clé ne prouve pas que ce modèle est disponible : une erreur explicite s’affichera à la rédaction.' }
      ],
      values: { model: or.model },
      submitLabel: 'Enregistrer',
      onSubmit: saveConnection,
      extraButtons: [
        el('button', { class: 'btn', type: 'button', text: 'Tester la clé', disabled: !or.configured, onclick: testConnection }),
        el('button', { class: 'btn danger', type: 'button', text: 'Déconnecter', disabled: !or.configured, onclick: disconnectAi })
      ]
    })
  ]);

  const assistant = agency.tools?.assistant ?? '';
  const skillsCard = el('div', { class: 'card stack' }, [
    el('h2', { text: '3. Skills et outils de votre assistant' }),
    el('p', { class: 'subtitle', text: 'Les skills sont des instructions pour Codex ou Claude Code. Copiez la commande adaptée et exécutez-la dans votre terminal : le cockpit n’exécute aucune commande.' }),
    commandBlock('node scripts/install-skills.mjs --target ~/.codex/skills'),
    commandBlock('node scripts/install-skills.mjs --target ~/.claude/skills'),
    el('p', { class: 'subtitle' }, [
      'Catalogue des 23 skills : ',
      el('a', { href: SKILLS_CATALOG_URL, target: '_blank', rel: 'noopener noreferrer', text: 'docs/SKILLS.md' }),
      '. Les comptes (recherche, ads, email) se connectent dans l’interface habituelle de votre assistant.'
    ]),
    inlineForm({
      fields: [
        { name: 'assistant', label: 'Assistant utilisé', type: 'select', options: [{ value: '', label: '— Non choisi —' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude Code' }, { value: 'other', label: 'Autre' }] },
        { name: 'skillsInstalled', label: 'J’ai installé les skills dans mon assistant (déclaration, non vérifiée par le cockpit)', type: 'checkbox' }
      ],
      values: { assistant, skillsInstalled: skillsDeclared },
      submitLabel: 'Enregistrer',
      onSubmit: (values) => saveAgency({ tools: { assistant: values.assistant, skillsInstalled: values.skillsInstalled } })
    }),
    el('h3', { text: 'Extensions à configurer dans votre assistant' }),
    el(
      'ul',
      { class: 'checklist' },
      [
        ['Meta Ads (diffusion, comptes publicitaires)', 'skill meta-ads-* + accès Business Manager'],
        ['Cold email (envoi, boîte, désinscription)', 'outil d’envoi de votre choix + skill outbound'],
        ['Génération d’images et vidéos', 'outils de génération de votre assistant ; le cockpit ne produit que du texte']
      ].map(([label, how]) =>
        el('li', {}, [
          el('span', {}, [label, ' ', el('span', { class: 'badge', text: 'non intégré au cockpit' }), el('span', { class: 'hint', text: ` ${how}` })])
        ])
      )
    )
  ]);

  const clientsCard = el('div', { class: 'card stack' }, [
    el('h2', { text: '4. Premier client et onboarding' }),
    el('p', { class: 'subtitle', text: 'Créez un client puis remplissez son questionnaire (seul ou avec le client). La soumission crée sa campagne brouillon, sa checklist et son brief.' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn primary', text: 'Nouveau client + questionnaire', onclick: () => newClient({ thenOnboarding: true }) }),
      state.db.clients.length === 0
        ? el('button', {
            class: 'btn',
            text: 'Charger la démo (fictive)',
            onclick: async () => {
              const ok = await openConfirm({ title: 'Charger les données de démonstration ?', message: 'Un client fictif « Atelier Démo » et sa campagne seront ajoutés.', confirmLabel: 'Charger la démo' });
              if (ok) await run(() => api('/api/demo', { method: 'POST' }), 'Démo chargée (données fictives).');
            }
          })
        : null
    ]),
    state.db.clients.length === 0
      ? null
      : table(
          ['Client', 'Questionnaire', 'Progression', 'Actions'],
          state.db.clients.map((c) => {
            const ob = c.onboarding;
            return el('tr', {}, [
              el('td', {}, [el('button', { class: 'link', text: c.company, onclick: () => openClient(c.id) })]),
              el('td', {}, [ob ? badge(ob.status, ONBOARDING_STATUS_LABEL[ob.status]) : el('span', { class: 'badge', text: 'Non commencé' })]),
              el('td', { text: ob ? `étape ${(ob.step ?? 0) + 1}/5` : '—' }),
              el('td', {}, [el('button', { class: 'btn small', text: ob ? 'Reprendre' : 'Commencer', onclick: () => openOnboarding(c.id) })])
            ]);
          })
        )
  ]);

  return [
    pageHead('Start Here', inBizos ? 'Votre agence dans BizOS local : les agents et ce dashboard partagent les mêmes clients, campagnes et livrables.' : 'Configurez votre agence, votre IA et vos outils, puis lancez votre premier onboarding.'),
    progress,
    profileCard,
    inBizos ? el('div', { class: 'card stack' }, [
      el('h2', { text: '2. Vos agents dans BizOS' }),
      el('p', { text: 'Dans les réglages de BizOS, connectez votre modèle personnel. Dans Discussions, demandez à Agency Director de créer votre premier client et de préparer son onboarding.' }),
      el('p', { text: 'Les modifications enregistrées par les agents apparaissent ici automatiquement. Pendant une saisie, un avis vous permet de les charger quand vous êtes prêt.' })
    ]) : aiCard,
    inBizos ? el('div', { class: 'card stack' }, [
      el('h2', { text: '3. Skills LeadFactory inclus' }),
      el('p', { text: 'Les 21 skills issus de LeadFactory et les deux compléments offre et relation client sont inclus dans le template. Les agents consultent les instructions et références utiles à chaque mission ; aucune installation manuelle dans votre assistant n’est nécessaire.' }),
      el('a', { href: SKILLS_CATALOG_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Consulter les skills LeadFactory' }),
      el('p', { text: 'Connectez vos outils d’envoi de cold emails, de publicité et de génération de médias dans BizOS. Le template ne fournit pas ces comptes.' })
    ]) : skillsCard,
    clientsCard
  ];
}

// --- Questionnaire d'onboarding --------------------------------------------

function viewOnboarding() {
  const client = state.db.clients.find((c) => c.id === state.clientId);
  const data = state.onboarding;
  if (!client || !data || !state.schema) {
    return [
      pageHead('Questionnaire indisponible', 'Client introuvable ou schéma non chargé.', [backToClientsButton()]),
      emptyState('Ce questionnaire n’est plus accessible. Les autres clients sont intacts.')
    ];
  }
  const ob = data.onboarding;
  const progress = data.progress;
  const steps = state.schema.steps;
  const current = Math.min(Math.max(state.onboardingStep, 0), steps.length - 1);
  const stepDef = steps[current];
  const campaign = ob.campaignId ? state.db.campaigns.find((c) => c.id === ob.campaignId) : null;
  const brief = ob.briefId ? state.db.deliverables.find((d) => d.id === ob.briefId) : null;

  const header = el('div', { class: 'card stack' }, [
    el('div', { class: 'row-between' }, [
      el('div', {}, ['Statut : ', badge(ob.status, ONBOARDING_STATUS_LABEL[ob.status]), ob.submittedAt ? ` soumis le ${formatDate(ob.submittedAt)}` : '', ob.reviewedAt ? `, revu le ${formatDate(ob.reviewedAt)}` : '']),
      el('div', { text: `${progress.filled}/${progress.total} champs requis (${progress.percent} %)` })
    ]),
    el('div', { class: 'progress' }, [el('div', { class: 'progress-bar', style: `width:${progress.percent}%` })]),
    progress.missing.length > 0
      ? el('p', { class: 'hint', text: `Manquant : ${progress.missing.map((m) => `${m.stepLabel} › ${m.label}`).join(', ')}` })
      : el('p', { class: 'hint', text: 'Tous les champs requis sont remplis.' })
  ]);

  const tabs = el('div', { class: 'tabs' }, steps.map((s, i) =>
    el('button', {
      type: 'button',
      class: `tab ${i === current ? 'active' : ''}`,
      text: `${i + 1}. ${s.label}`,
      onclick: async () => {
        try {
          await saveOnboardingStep(client.id, stepDef, form, { silent: true });
        } catch (err) {
          toast(err.message, 'error');
          return;
        }
        state.onboardingStep = i;
        render();
      }
    })
  ));

  const form = el('form', { class: 'stack', novalidate: true });
  for (const field of stepDef.fields) {
    const name = `${stepDef.key}.${field.name}`;
    const value = ob[stepDef.key]?.[field.name];
    let input;
    if (field.type === 'textarea') input = el('textarea', { name, rows: 3, value: value ?? '' });
    else if (field.type === 'channel') {
      input = el('select', { name }, [
        el('option', { value: '', text: '— Choisir —', selected: !value }),
        ...state.schema.channels.map((c) => el('option', { value: c, text: CHANNEL_LABEL[c] ?? c, selected: value === c }))
      ]);
    } else if (field.type === 'bool') input = el('input', { name, type: 'checkbox', checked: Boolean(value), style: 'width:auto' });
    else if (field.type === 'number') input = el('input', { name, type: 'number', step: '0.01', min: '0', value: value === null || value === undefined ? '' : String(value) });
    else input = el('input', { name, type: field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text', value: value ?? '' });
    input.id = name;
    form.append(
      field.type === 'bool'
        ? el('label', { class: 'filters', style: 'gap:8px' }, [input, field.label])
        : el('div', { class: 'field' }, [el('label', { for: name, text: field.required ? `${field.label} *` : field.label }), input, field.hint ? el('span', { class: 'hint', text: field.hint }) : null])
    );
  }
  const errorNode = el('p', { class: 'dialog-error' });
  form.append(errorNode);

  const act = async (fn) => {
    errorNode.textContent = '';
    try {
      await fn();
    } catch (err) {
      errorNode.textContent = err.message;
      toast(err.message, 'error');
    }
  };
  const isLast = current === steps.length - 1;
  form.append(
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', type: 'button', text: '← Précédent', disabled: current === 0, onclick: () => act(async () => { await saveOnboardingStep(client.id, stepDef, form, { silent: true }); state.onboardingStep = current - 1; render(); }) }),
      el('button', { class: 'btn', type: 'button', text: 'Enregistrer le brouillon', onclick: () => act(async () => { await saveOnboardingStep(client.id, stepDef, form); await refresh(); render(); }) }),
      isLast
        ? el('button', { class: 'btn primary', type: 'button', text: ob.status === 'draft' ? 'Soumettre le questionnaire' : 'Soumettre à nouveau', onclick: () => act(async () => { await saveOnboardingStep(client.id, stepDef, form, { silent: true }); await submitOnboarding(client.id); }) })
        : el('button', { class: 'btn primary', type: 'button', text: 'Suivant →', onclick: () => act(async () => { await saveOnboardingStep(client.id, stepDef, form, { silent: true }); state.onboardingStep = current + 1; render(); }) })
    ])
  );
  form.addEventListener('submit', (e) => e.preventDefault());

  const recap = ob.status === 'draft'
    ? null
    : el('div', { class: 'card stack' }, [
        el('h2', { text: 'Récapitulatif de la soumission' }),
        el('dl', { class: 'definition' }, [
          el('dt', { text: 'Campagne liée' }),
          el('dd', {}, campaign ? [campaign.name, ' ', badge(campaign.status, CAMPAIGN_STATUS_LABEL[campaign.status]), ' ', el('button', { class: 'btn small', text: 'Ouvrir la campagne', onclick: () => editCampaign(campaign) })] : ['Campagne supprimée : une nouvelle soumission en recréera une.']),
          el('dt', { text: 'Brief' }),
          el('dd', {}, brief ? [brief.title, ' ', el('button', { class: 'btn small', text: 'Ouvrir le brief', onclick: () => editDeliverable(brief) })] : ['Brief supprimé : une nouvelle soumission le recréera.']),
          el('dt', { text: 'Checklist' }),
          el('dd', { text: `${state.db.tasks.filter((t) => t.clientId === client.id && t.onboardingKey).length} tâche(s) d’onboarding dans le dossier client` })
        ]),
        el('div', { class: 'actions' }, [
          ob.status === 'submitted' ? el('button', { class: 'btn primary', text: 'Marquer revu', onclick: () => reviewOnboarding(client.id) }) : null,
          el('button', { class: 'btn', text: 'Ouvrir le dossier client', onclick: () => openClient(client.id) })
        ])
      ]);

  return [
    pageHead(`Onboarding — ${client.company}`, 'Questionnaire rempli par l’opérateur, seul ou avec le client. Brouillon sauvegardé à chaque changement d’étape.', [
      el('button', { class: 'btn', text: '← Dossier client', onclick: () => openClient(client.id) })
    ]),
    header,
    recap,
    el('div', { class: 'card stack' }, [tabs, el('h2', { text: stepDef.label }), form])
  ];
}

function onboardingCard(client) {
  const ob = client.onboarding;
  const campaign = ob?.campaignId ? state.db.campaigns.find((c) => c.id === ob.campaignId) : null;
  const required = state.schema?.requiredCount ?? 0;
  let filled = null;
  if (ob && state.schema) {
    filled = state.schema.steps.flatMap((s) => s.fields.filter((f) => f.required).map((f) => ob[s.key]?.[f.name])).filter((v) => (typeof v === 'number' ? Number.isFinite(v) && v >= 0 : typeof v === 'string' && v.trim() !== '')).length;
  }
  return el('div', { class: 'card stack' }, [
    el('div', { class: 'row-between' }, [
      el('h2', { text: 'Questionnaire d’onboarding' }),
      ob ? badge(ob.status, ONBOARDING_STATUS_LABEL[ob.status]) : el('span', { class: 'badge', text: 'Non commencé' })
    ]),
    ob
      ? el('dl', { class: 'definition' }, [
          el('dt', { text: 'Progression' }),
          el('dd', { text: filled === null ? '—' : `${filled}/${required} champs requis, étape ${(ob.step ?? 0) + 1}/5` }),
          el('dt', { text: 'Soumis' }),
          el('dd', { text: ob.submittedAt ? formatDate(ob.submittedAt) : 'non' }),
          el('dt', { text: 'Revu' }),
          el('dd', { text: ob.reviewedAt ? formatDate(ob.reviewedAt) : 'non' }),
          el('dt', { text: 'Campagne liée' }),
          el('dd', { text: campaign ? campaign.name : '—' })
        ])
      : el('p', { class: 'subtitle', text: 'Entreprise, offre, cible, campagne, livraison : cinq étapes, brouillon reprenable.' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn primary', text: ob ? 'Modifier le questionnaire' : 'Commencer le questionnaire', onclick: () => openOnboarding(client.id) }),
      ob?.status === 'submitted' ? el('button', { class: 'btn', text: 'Marquer revu', onclick: () => run(() => api(`/api/clients/${client.id}/onboarding/review`, { method: 'POST' }), 'Questionnaire marqué comme revu.') }) : null
    ])
  ]);
}

function viewDashboard() {
  const db = state.db;
  const isEmpty =
    db.clients.length === 0 && db.campaigns.length === 0 && db.tasks.length === 0 && db.deliverables.length === 0;
  const openTasks = db.tasks.filter((t) => !t.done).length;

  const kpis = [
    ['Clients', db.clients.length],
    ['Clients actifs', db.clients.filter((c) => c.status === 'actif').length],
    ['Campagnes', db.campaigns.length],
    ['Campagnes actives', db.campaigns.filter((c) => c.status === 'active').length],
    ['Tâches à faire', openTasks],
    ['Tâches terminées', db.tasks.length - openTasks],
    ['Livrables', db.deliverables.length]
  ];

  const nodes = [
    pageHead('Tableau de bord', 'Compteurs calculés à partir de vos saisies uniquement.', [
      el('button', { class: 'btn primary', text: 'Nouveau client', onclick: newClient })
    ]),
    el('div', { class: 'grid' }, kpis.map(([label, value]) => el('div', { class: 'kpi' }, [el('b', { text: String(value) }), el('span', { text: label })])))
  ];

  if (isEmpty) {
    nodes.push(
      el('div', { class: 'card stack' }, [
        el('h2', { text: 'Base vide' }),
        el('p', {
          class: 'subtitle',
          text: 'Créez un client, ou chargez un jeu de démonstration fictif (entreprise « Atelier Démo », domaine example.com) pour explorer l’outil.'
        }),
        el('div', { class: 'actions' }, [
          el('button', { class: 'btn primary', text: 'Nouveau client', onclick: newClient }),
          el('button', {
            class: 'btn',
            text: 'Charger la démo',
            onclick: async () => {
              const ok = await openConfirm({
                title: 'Charger les données de démonstration ?',
                message: 'Un client fictif « Atelier Démo » et sa campagne seront ajoutés. Vous pourrez les supprimer ensuite.',
                confirmLabel: 'Charger la démo'
              });
              if (ok) await run(() => api('/api/demo', { method: 'POST' }), 'Démo chargée (données fictives).');
            }
          })
        ])
      ])
    );
  } else {
    const recent = [...db.tasks].filter((t) => !t.done).slice(0, 8);
    nodes.push(
      el('div', { class: 'card' }, [
        el('h2', { text: 'Tâches en cours' }),
        recent.length === 0
          ? emptyState('Aucune tâche ouverte.')
          : el(
              'ul',
              { class: 'checklist' },
              recent.map((task) => {
                const client = db.clients.find((c) => c.id === task.clientId);
                return el('li', {}, [
                  el('input', {
                    type: 'checkbox',
                    checked: false,
                    'aria-label': `Marquer « ${task.title} » comme terminée`,
                    onchange: () => toggleTask(task, true)
                  }),
                  el('span', {}, [task.title, ' ', el('span', { class: 'badge', text: client?.company ?? 'client inconnu' })])
                ]);
              })
            )
      ])
    );
  }
  return nodes;
}

function viewClients() {
  const term = state.search.trim().toLowerCase();
  const list = state.db.clients.filter((c) => {
    const matchStatus = !state.clientStatus || c.status === state.clientStatus;
    const haystack = `${c.company} ${c.contact} ${c.email} ${c.offer} ${c.audience} ${c.goal}`.toLowerCase();
    return matchStatus && (term === '' || haystack.includes(term));
  });

  const rows = list.map((client) => {
    const counts = countsFor(client.id);
    return el('tr', {}, [
      el('td', {}, [el('button', { class: 'link', text: client.company, onclick: () => openClient(client.id) })]),
      el('td', { text: client.contact || '—' }),
      el('td', {}, [badge(client.status, CLIENT_STATUS_LABEL[client.status])]),
      el('td', { text: String(counts.campaigns) }),
      el('td', { text: `${counts.openTasks}/${counts.tasks}` }),
      el('td', { text: euros(client.budget) }),
      el('td', {}, [
        el('div', { class: 'actions' }, [
          el('button', { class: 'btn small', text: 'Ouvrir', onclick: () => openClient(client.id) }),
          el('button', { class: 'btn small', text: 'Modifier', onclick: () => editClient(client) }),
          el('button', { class: 'btn small danger', text: 'Supprimer', onclick: () => deleteClient(client) })
        ])
      ])
    ]);
  });

  return [
    pageHead('Clients', `${state.db.clients.length} client(s) enregistré(s).`, [
      el('button', { class: 'btn primary', text: 'Nouveau client', onclick: newClient })
    ]),
    el('div', { class: 'card stack' }, [
      el('div', { class: 'filters' }, [
        el('input', {
          type: 'search',
          value: state.search,
          placeholder: 'Rechercher (entreprise, contact, offre…)',
          'aria-label': 'Rechercher un client',
          oninput: (e) => {
            state.search = e.target.value;
            render({ keepFocus: 'search' });
          }
        }),
        el(
          'select',
          {
            'aria-label': 'Filtrer par statut',
            onchange: (e) => {
              state.clientStatus = e.target.value;
              render();
            }
          },
          [
            el('option', { value: '', text: 'Tous les statuts', selected: state.clientStatus === '' }),
            ...CLIENT_STATUS.map((s) =>
              el('option', { value: s, text: CLIENT_STATUS_LABEL[s], selected: state.clientStatus === s })
            )
          ]
        )
      ]),
      rows.length === 0
        ? emptyState(
            state.db.clients.length === 0
              ? 'Aucun client pour l’instant. Cliquez sur « Nouveau client » pour commencer.'
              : 'Aucun client ne correspond à cette recherche.'
          )
        : table(['Entreprise', 'Contact', 'Statut', 'Campagnes', 'Tâches', 'Budget', 'Actions'], rows)
    ])
  ];
}

function viewClientDetail() {
  const client = state.db.clients.find((c) => c.id === state.clientId);
  if (!client) {
    return [
      pageHead('Client introuvable', 'Il a peut-être été supprimé ailleurs.', [backToClientsButton()]),
      emptyState('Ce dossier n’existe plus. Les autres clients sont intacts.')
    ];
  }
  const campaigns = state.db.campaigns.filter((c) => c.clientId === client.id);
  const tasks = state.db.tasks.filter((t) => t.clientId === client.id);
  const deliverables = state.db.deliverables.filter((d) => d.clientId === client.id);
  const campaignName = (id) => campaigns.find((c) => c.id === id)?.name;

  let generateCampaignId = '';

  const fiche = el('div', { class: 'card' }, [
    el('div', { class: 'row-between' }, [el('h2', { text: 'Fiche client' }), badge(client.status, CLIENT_STATUS_LABEL[client.status])]),
    el('dl', { class: 'definition' }, [
      el('dt', { text: 'Contact' }),
      el('dd', { text: client.contact || '—' }),
      el('dt', { text: 'Email' }),
      el('dd', { text: client.email || '—' }),
      el('dt', { text: 'Offre' }),
      el('dd', { text: client.offer || '—' }),
      el('dt', { text: 'Audience' }),
      el('dd', { text: client.audience || '—' }),
      el('dt', { text: 'Objectif' }),
      el('dd', { text: client.goal || '—' }),
      el('dt', { text: 'Budget' }),
      el('dd', { text: euros(client.budget) }),
      el('dt', { text: 'Notes' }),
      el('dd', { text: client.notes || '—' })
    ])
  ]);

  const generation = el('div', { class: 'card stack' }, [
    el('h2', { text: 'Brouillons préremplis' }),
    el('p', {
      class: 'note',
      text: 'Ces boutons remplissent un modèle à partir des champs du client. Résultat identique à chaque fois : aucune IA, aucun envoi, aucune créative image ou vidéo n’est produite.'
    }),
    el('div', { class: 'field' }, [
      el('label', { for: 'gen-campaign', text: 'Campagne associée (facultatif)' }),
      el(
        'select',
        {
          id: 'gen-campaign',
          onchange: (e) => {
            generateCampaignId = e.target.value;
          }
        },
        campaignOptions(client.id).map((opt) => el('option', { value: opt.value, text: opt.label }))
      )
    ]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn',
        text: 'Séquence cold email (3 messages)',
        onclick: () => generate('cold-email', client.id, generateCampaignId)
      }),
      el('button', {
        class: 'btn',
        text: 'Brief créatif',
        onclick: () => generate('creative-brief', client.id, generateCampaignId)
      }),
      el('button', {
        class: 'btn',
        text: 'Brief onboarding',
        onclick: () => generate('onboarding-brief', client.id, '')
      })
    ])
  ]);

  const or = state.connections.openrouter;
  const aiReady = or.configured && or.model !== '';
  let aiKind = 'cold-email';
  const aiCard = el('div', { class: 'card stack' }, [
    el('h2', { text: 'Rédiger avec mon IA' }),
    el('p', {
      class: 'note',
      text: aiReady
        ? `Envoie les champs de ce client (et de la campagne choisie ci-dessus) à OpenRouter, modèle « ${or.model} ». Appel facturable par le fournisseur, une seule requête par clic. Le texte obtenu est un livrable « rédigé par IA », distinct des modèles préremplis. Aucune image ni vidéo n’est produite.`
        : 'Aucune connexion IA configurée. Renseignez une clé OpenRouter et un modèle dans Start Here pour activer ce bouton.'
    }),
    el('div', { class: 'filters' }, [
      el('select', { 'aria-label': 'Type de texte à rédiger', onchange: (e) => { aiKind = e.target.value; } }, [
        el('option', { value: 'cold-email', text: 'Séquence cold email' }),
        el('option', { value: 'creative-brief', text: 'Brief créatif' }),
        el('option', { value: 'onboarding-brief', text: 'Brief onboarding' })
      ]),
      el('button', {
        class: 'btn primary',
        text: 'Rédiger avec mon IA',
        disabled: !aiReady,
        onclick: () => generateWithAi(aiKind, client.id, aiKind === 'onboarding-brief' ? '' : generateCampaignId)
      }),
      aiReady ? null : el('button', { class: 'btn', text: 'Ouvrir Start Here', onclick: () => { state.view = 'start'; render(); } })
    ])
  ]);

  const campaignCard = el('div', { class: 'card stack' }, [
    el('div', { class: 'row-between' }, [
      el('h2', { text: `Campagnes (${campaigns.length})` }),
      el('button', { class: 'btn small', text: 'Ajouter', onclick: () => newCampaign(client.id) })
    ]),
    campaigns.length === 0
      ? emptyState('Aucune campagne pour ce client.')
      : table(
          ['Nom', 'Canal', 'Statut', 'Budget', 'Actions'],
          campaigns.map((c) =>
            el('tr', {}, [
              el('td', { text: c.name }),
              el('td', { text: CHANNEL_LABEL[c.channel] }),
              el('td', {}, [badge(c.status, CAMPAIGN_STATUS_LABEL[c.status])]),
              el('td', { text: euros(c.budget) }),
              el('td', {}, [
                el('div', { class: 'actions' }, [
                  el('button', { class: 'btn small', text: 'Modifier', onclick: () => editCampaign(c) }),
                  el('button', { class: 'btn small danger', text: 'Supprimer', onclick: () => deleteCampaign(c) })
                ])
              ])
            ])
          )
        )
  ]);

  const taskCard = el('div', { class: 'card stack' }, [
    el('div', { class: 'row-between' }, [
      el('h2', { text: `Tâches (${tasks.filter((t) => t.done).length}/${tasks.length})` }),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn small', text: 'Checklist onboarding', onclick: () => runOnboarding(client) }),
        el('button', { class: 'btn small', text: 'Ajouter', onclick: () => newTask(client.id) })
      ])
    ]),
    tasks.length === 0
      ? emptyState('Aucune tâche. La checklist d’onboarding peut être créée en un clic (elle ne crée jamais de doublon).')
      : el(
          'ul',
          { class: 'checklist' },
          tasks.map((task) =>
            el('li', {}, [
              el('input', {
                type: 'checkbox',
                checked: task.done,
                'aria-label': `Tâche « ${task.title} » terminée`,
                onchange: (e) => toggleTask(task, e.target.checked)
              }),
              el('span', { class: task.done ? 'done' : '' }, [
                task.title,
                task.campaignId ? ' ' : null,
                task.campaignId ? el('span', { class: 'badge', text: campaignName(task.campaignId) ?? 'campagne' }) : null
              ]),
              el('button', {
                class: 'btn small danger',
                style: 'margin-left:auto',
                text: 'Supprimer',
                onclick: () => deleteTask(task)
              })
            ])
          )
        )
  ]);

  const deliverableCard = el('div', { class: 'card stack' }, [
    el('div', { class: 'row-between' }, [
      el('h2', { text: `Livrables (${deliverables.length})` }),
      el('button', { class: 'btn small', text: 'Ajouter', onclick: () => newDeliverable(client.id) })
    ]),
    deliverables.length === 0
      ? emptyState('Aucun livrable. Utilisez les brouillons préremplis ci-dessus ou créez-en un vide.')
      : el(
          'div',
          { class: 'stack' },
          deliverables.map((item) =>
            el('div', { class: 'card stack' }, [
              el('div', { class: 'row-between' }, [
                el('div', {}, [
                  el('h3', { text: item.title }),
                  el('span', { class: 'badge', text: DELIVERABLE_LABEL[item.type] }),
                  item.campaignId ? ' ' : null,
                  item.campaignId ? el('span', { class: 'badge', text: campaignName(item.campaignId) ?? 'campagne' }) : null,
                  ' ',
                  sourceBadge(item)
                ]),
                el('div', { class: 'actions' }, [
                  el('button', { class: 'btn small', text: 'Modifier', onclick: () => editDeliverable(item) }),
                  el('button', { class: 'btn small danger', text: 'Supprimer', onclick: () => deleteDeliverable(item) })
                ])
              ]),
              el('div', { class: 'pre', text: item.content || '(vide)' })
            ])
          )
        )
  ]);

  return [
    pageHead(client.company, 'Dossier client complet.', [
      el('button', { class: 'btn', text: '← Clients', onclick: () => {
        state.view = 'clients';
        render();
      } }),
      el('button', { class: 'btn', text: 'Modifier', onclick: () => editClient(client) }),
      el('a', { class: 'btn', href: `/api/clients/${client.id}/dossier.md`, download: '', text: 'Export Markdown' }),
      el('button', { class: 'btn danger', text: 'Supprimer', onclick: () => deleteClient(client) })
    ]),
    fiche,
    onboardingCard(client),
    generation,
    state.hostedBy === 'bizos-local' ? el('div', { class: 'card stack' }, [
      el('h2', { text: 'Travailler avec vos agents' }),
      el('p', { text: `Dans BizOS, demandez à un agent de travailler sur le client « ${client.company} ». Ses briefs, séquences et comptes rendus enregistrés apparaîtront dans les livrables de ce dossier.` })
    ]) : aiCard,
    campaignCard,
    taskCard,
    deliverableCard
  ];
}

function sourceBadge(item) {
  if (item.source === 'ai') return el('span', { class: 'badge ai', text: `rédigé par IA · ${item.model}` });
  if (item.source === 'template' || item.generated) return el('span', { class: 'badge draft', text: 'modèle prérempli' });
  return null;
}

function viewCampaigns() {
  const term = state.search.trim().toLowerCase();
  const list = state.db.campaigns.filter((c) => {
    if (state.campaignClient && c.clientId !== state.campaignClient) return false;
    if (state.campaignStatus && c.status !== state.campaignStatus) return false;
    return term === '' || `${c.name} ${c.goal} ${c.channel}`.toLowerCase().includes(term);
  });
  const clientName = (id) => state.db.clients.find((c) => c.id === id)?.company ?? 'client inconnu';

  return [
    pageHead('Campagnes', `${state.db.campaigns.length} campagne(s).`, [
      el('button', {
        class: 'btn primary',
        text: 'Nouvelle campagne',
        onclick: () => newCampaign(state.campaignClient),
        disabled: state.db.clients.length === 0
      })
    ]),
    state.db.clients.length === 0
      ? el('div', { class: 'card' }, [emptyState('Créez d’abord un client : une campagne est toujours rattachée à un client.')])
      : el('div', { class: 'card stack' }, [
          el('div', { class: 'filters' }, [
            el('input', {
              type: 'search',
              value: state.search,
              placeholder: 'Rechercher une campagne',
              'aria-label': 'Rechercher une campagne',
              oninput: (e) => {
                state.search = e.target.value;
                render({ keepFocus: 'search' });
              }
            }),
            el(
              'select',
              {
                'aria-label': 'Filtrer par client',
                onchange: (e) => {
                  state.campaignClient = e.target.value;
                  render();
                }
              },
              [
                el('option', { value: '', text: 'Tous les clients', selected: state.campaignClient === '' }),
                ...state.db.clients.map((c) =>
                  el('option', { value: c.id, text: c.company, selected: state.campaignClient === c.id })
                )
              ]
            ),
            el(
              'select',
              {
                'aria-label': 'Filtrer par statut',
                onchange: (e) => {
                  state.campaignStatus = e.target.value;
                  render();
                }
              },
              [
                el('option', { value: '', text: 'Tous les statuts', selected: state.campaignStatus === '' }),
                ...CAMPAIGN_STATUS.map((s) =>
                  el('option', { value: s, text: CAMPAIGN_STATUS_LABEL[s], selected: state.campaignStatus === s })
                )
              ]
            )
          ]),
          list.length === 0
            ? emptyState('Aucune campagne ne correspond.')
            : table(
                ['Campagne', 'Client', 'Canal', 'Statut', 'Budget', 'Actions'],
                list.map((c) =>
                  el('tr', {}, [
                    el('td', { text: c.name }),
                    el('td', {}, [el('button', { class: 'link', text: clientName(c.clientId), onclick: () => openClient(c.clientId) })]),
                    el('td', { text: CHANNEL_LABEL[c.channel] }),
                    el('td', {}, [badge(c.status, CAMPAIGN_STATUS_LABEL[c.status])]),
                    el('td', { text: euros(c.budget) }),
                    el('td', {}, [
                      el('div', { class: 'actions' }, [
                        el('button', { class: 'btn small', text: 'Modifier', onclick: () => editCampaign(c) }),
                        el('button', { class: 'btn small danger', text: 'Supprimer', onclick: () => deleteCampaign(c) })
                      ])
                    ])
                  ])
                )
              )
        ])
  ];
}

function viewTasks() {
  const list = state.db.tasks.filter((t) => {
    if (state.taskClient && t.clientId !== state.taskClient) return false;
    if (state.hideDoneTasks && t.done) return false;
    return true;
  });
  const clientName = (id) => state.db.clients.find((c) => c.id === id)?.company ?? 'client inconnu';
  const campaignName = (id) => state.db.campaigns.find((c) => c.id === id)?.name;

  return [
    pageHead('Tâches', `${state.db.tasks.filter((t) => !t.done).length} tâche(s) à faire.`, [
      el('button', {
        class: 'btn primary',
        text: 'Nouvelle tâche',
        onclick: () => newTask(state.taskClient),
        disabled: state.db.clients.length === 0
      })
    ]),
    el('div', { class: 'card stack' }, [
      el('div', { class: 'filters' }, [
        el(
          'select',
          {
            'aria-label': 'Filtrer par client',
            onchange: (e) => {
              state.taskClient = e.target.value;
              render();
            }
          },
          [
            el('option', { value: '', text: 'Tous les clients', selected: state.taskClient === '' }),
            ...state.db.clients.map((c) => el('option', { value: c.id, text: c.company, selected: state.taskClient === c.id }))
          ]
        ),
        el('label', { class: 'filters', style: 'gap:6px' }, [
          el('input', {
            type: 'checkbox',
            checked: state.hideDoneTasks,
            style: 'width:auto',
            onchange: (e) => {
              state.hideDoneTasks = e.target.checked;
              render();
            }
          }),
          'Masquer les tâches terminées'
        ])
      ]),
      list.length === 0
        ? emptyState(state.db.tasks.length === 0 ? 'Aucune tâche enregistrée.' : 'Aucune tâche ne correspond au filtre.')
        : el(
            'ul',
            { class: 'checklist' },
            list.map((task) =>
              el('li', {}, [
                el('input', {
                  type: 'checkbox',
                  checked: task.done,
                  'aria-label': `Tâche « ${task.title} » terminée`,
                  onchange: (e) => toggleTask(task, e.target.checked)
                }),
                el('span', { class: task.done ? 'done' : '' }, [
                  task.title,
                  ' ',
                  el('button', { class: 'link', text: clientName(task.clientId), onclick: () => openClient(task.clientId) }),
                  task.campaignId ? ' ' : null,
                  task.campaignId ? el('span', { class: 'badge', text: campaignName(task.campaignId) ?? 'campagne' }) : null
                ]),
                el('button', { class: 'btn small danger', style: 'margin-left:auto', text: 'Supprimer', onclick: () => deleteTask(task) })
              ])
            )
          )
    ])
  ];
}

function viewDeliverables() {
  const term = state.search.trim().toLowerCase();
  const list = state.db.deliverables.filter((d) => {
    if (state.deliverableClient && d.clientId !== state.deliverableClient) return false;
    return term === '' || `${d.title} ${d.content}`.toLowerCase().includes(term);
  });
  const clientName = (id) => state.db.clients.find((c) => c.id === id)?.company ?? 'client inconnu';

  return [
    pageHead('Livrables', `${state.db.deliverables.length} document(s) texte.`, [
      el('button', {
        class: 'btn primary',
        text: 'Nouveau livrable',
        onclick: () => newDeliverable(state.deliverableClient),
        disabled: state.db.clients.length === 0
      })
    ]),
    el('div', { class: 'card stack' }, [
      el('div', { class: 'filters' }, [
        el('input', {
          type: 'search',
          value: state.search,
          placeholder: 'Rechercher dans les livrables',
          'aria-label': 'Rechercher un livrable',
          oninput: (e) => {
            state.search = e.target.value;
            render({ keepFocus: 'search' });
          }
        }),
        el(
          'select',
          {
            'aria-label': 'Filtrer par client',
            onchange: (e) => {
              state.deliverableClient = e.target.value;
              render();
            }
          },
          [
            el('option', { value: '', text: 'Tous les clients', selected: state.deliverableClient === '' }),
            ...state.db.clients.map((c) =>
              el('option', { value: c.id, text: c.company, selected: state.deliverableClient === c.id })
            )
          ]
        )
      ]),
      list.length === 0
        ? emptyState('Aucun livrable à afficher.')
        : table(
            ['Titre', 'Client', 'Type', 'Origine', 'Actions'],
            list.map((item) =>
              el('tr', {}, [
                el('td', { text: item.title }),
                el('td', {}, [el('button', { class: 'link', text: clientName(item.clientId), onclick: () => openClient(item.clientId) })]),
                el('td', { text: DELIVERABLE_LABEL[item.type] }),
                el('td', { text: item.source === 'ai' ? `${SOURCE_LABEL.ai} (${item.model})` : SOURCE_LABEL[item.source] ?? (item.generated ? SOURCE_LABEL.template : SOURCE_LABEL.manual) }),
                el('td', {}, [
                  el('div', { class: 'actions' }, [
                    el('button', { class: 'btn small', text: 'Ouvrir', onclick: () => editDeliverable(item) }),
                    el('button', { class: 'btn small danger', text: 'Supprimer', onclick: () => deleteDeliverable(item) })
                  ])
                ])
              ])
            )
          )
    ])
  ];
}

function viewData() {
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: 'width:auto' });

  async function doImport() {
    const file = fileInput.files?.[0];
    if (!file) {
      toast('Choisissez d’abord un fichier JSON.', 'error');
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      toast('Fichier illisible : ce n’est pas du JSON valide.', 'error');
      return;
    }
    const ok = await openConfirm({
      title: 'Remplacer toutes les données ?',
      message: `L’import remplace intégralement le contenu actuel (${state.db.clients.length} client(s), ${state.db.campaigns.length} campagne(s)). Exportez d’abord si besoin.`,
      confirmLabel: 'Remplacer',
      danger: true
    });
    if (!ok) return;
    const result = await run(() => api('/api/import', { method: 'POST', body: payload }));
    fileInput.value = '';
    toast(
      `Import terminé : ${result.imported.clients} client(s), ${result.imported.campaigns} campagne(s), ${result.imported.tasks} tâche(s), ${result.imported.deliverables} livrable(s).`
    );
  }

  return [
    pageHead('Données', 'Sauvegarde locale, export et import.'),
    el('div', { class: 'card stack' }, [
      el('h2', { text: 'Export' }),
      el('p', { class: 'subtitle', text: 'Télécharge l’intégralité de la base au format JSON (profil d’agence, clients avec questionnaire, campagnes, tâches, livrables). La clé OpenRouter n’en fait jamais partie.' }),
      el('div', { class: 'actions' }, [
        el('a', { class: 'btn primary', href: '/api/export', download: 'leadfactory-export.json', text: 'Exporter le JSON' })
      ])
    ]),
    el('div', { class: 'card stack' }, [
      el('h2', { text: 'Import' }),
      el('p', { class: 'note', text: 'L’import exige un export complet (version et quatre collections), le valide, puis remplace toutes les données existantes. Un export sans profil d’agence conserve le profil actuel. Limite : 25 Mo par fichier, base de 20 Mo maximum ; au-delà l’import est refusé avant toute écriture.' }),
      el('div', { class: 'filters' }, [fileInput, el('button', { class: 'btn', text: 'Importer', onclick: doImport })])
    ]),
    el('div', { class: 'card stack' }, [
      el('h2', { text: 'Où sont mes données ?' }),
      el('p', {
        class: 'subtitle',
        text: state.hostedBy === 'bizos-local' ? 'Ces données appartiennent à votre espace BizOS local. Les agents et ce dashboard utilisent la même base. Exportez une sauvegarde JSON pour la restaurer ailleurs. Les agents utilisent le modèle et les outils personnels que vous avez configurés dans BizOS.' : 'Dans le fichier data/db.json du projet, écrit de façon atomique à chaque modification, protégé par un verrou db.lock (une seule instance par dossier). La clé OpenRouter est dans data/connections.json (mode 0600). Rien n’est envoyé sur Internet en dehors du bouton « Rédiger avec mon IA » et du test de clé.'
      })
    ])
  ];
}

// --- Rendu ----------------------------------------------------------------

function renderNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(
    ...NAV.map((item) =>
      el('button', {
        type: 'button',
        text: item.label,
        'aria-current': (state.view === item.id || (item.id === 'clients' && (state.view === 'client' || state.view === 'onboarding'))) ? 'page' : null,
        onclick: () => {
          state.view = item.id;
          state.search = '';
          render();
        }
      })
    )
  );
}

function render({ keepFocus } = {}) {
  renderNav();
  const view = document.getElementById('view');
  const selection = keepFocus ? document.activeElement?.selectionStart : null;
  const views = {
    start: viewStart,
    onboarding: viewOnboarding,
    dashboard: viewDashboard,
    clients: viewClients,
    client: viewClientDetail,
    campaigns: viewCampaigns,
    tasks: viewTasks,
    deliverables: viewDeliverables,
    data: viewData
  };
  view.replaceChildren(...views[state.view]().filter(node => node !== null && node !== undefined));
  inputGuard?.capture(view);
  if (keepFocus === 'search') {
    const input = view.querySelector('input[type="search"]');
    if (input) {
      input.focus();
      if (selection !== null) input.setSelectionRange(selection, selection);
    }
  }
  // Les données lues par `refresh()` sont maintenant à l'écran : la révision
  // correspondante peut être considérée comme appliquée, pas avant.
  if (pendingAdopt !== null) {
    live?.adopt(pendingAdopt);
    pendingAdopt = null;
  }
}

async function boot() {
  document.getElementById('host-label').textContent = `${location.host} — données locales`;
  // BizOS opens a one-use ticket in the fragment, never its service credential.
  // Exchange it for an HttpOnly session before any business-data request.
  if (location.hash.startsWith('#connect=')) {
    const ticket = location.hash.slice('#connect='.length);
    history.replaceState(null, '', location.pathname + location.search);
    try {
      if (!/^[a-f0-9]{64}$/i.test(ticket)) throw new Error('Lien de connexion invalide. Rouvrez le dashboard depuis BizOS.');
      await api('/api/session', { method: 'POST', body: { ticket } });
    } catch {
      document.getElementById('view').replaceChildren(pageHead('Ouvrir depuis BizOS', 'Ce lien de connexion a expiré ou a déjà été utilisé. Dans BizOS local, ouvrez Apps → Agence LeadFactory → Ouvrir le dashboard.'));
      return;
    }
  }
  try {
    await startLive();
  } catch {
    // Sans la boucle de synchronisation, l'outil reste utilisable manuellement.
    toast('Synchronisation automatique indisponible : rechargez la page pour voir les changements externes.', 'error');
  }
  try {
    await refresh();
    [state.connections, state.schema] = await Promise.all([api('/api/connections'), api('/api/onboarding/schema')]);
    setSave('idle');
    // Start Here est l'écran initial tant que l'agence n'est pas configurée.
    state.view = agencyConfigured() ? 'dashboard' : 'start';
  } catch (err) {
    live?.stop();
    document.getElementById('view').replaceChildren(pageHead('Dashboard indisponible', err.message, [
      el('button', { class: 'btn', text: 'Réessayer', onclick: () => location.reload() })
    ]));
    return;
  }
  render();
}

boot();
