// Cockpit e-commerce : rendu, formulaires et écritures.
//
// Tout est construit depuis `GET /api/schema` : les champs, les listes de
// valeurs et les relations affichées viennent du serveur, jamais d'une copie
// locale du modèle. Ajouter un champ côté serveur le rend saisissable ici sans
// modifier ce fichier.
//
// Aucun contenu n'est injecté en HTML : uniquement `textContent` et des nœuds
// créés par `el()`. La configuration du dashboard est déclarative et ne peut
// donc pas exécuter de code.

import { createInputGuard, createLiveRefresh } from '/live-refresh.js';

// --- Petits utilitaires DOM ------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') throw new Error('html interdit');
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const $ = (id) => document.getElementById(id);
const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};

// --- Libellés d'affichage (identifiants ASCII côté serveur) ----------------

const VALUE_LABELS = {
  idea: 'Idée',
  researching: 'En recherche',
  validated: 'Validé',
  rejected: 'Écarté',
  launched: 'Lancé',
  shopify: 'Shopify',
  other: 'Autre',
  planned: 'Prévue',
  building: 'En construction',
  preview: 'Aperçu',
  live: 'En ligne (déclaré)',
  image: 'Image',
  video: 'Vidéo',
  ugc: 'UGC',
  copy: 'Texte',
  email: 'Email',
  landing: 'Landing page',
  draft: 'Brouillon',
  ready: 'Prêt',
  published: 'Publié',
  meta: 'Meta',
  google: 'Google',
  tiktok: 'TikTok',
  seo: 'SEO',
  active: 'Active',
  paused: 'En pause',
  done: 'Terminé',
  todo: 'À faire',
  doing: 'En cours',
  blocked: 'Bloqué'
};

function valueLabel(value) {
  if (value === null || value === '') return '—';
  return state.schema?.stageLabels?.[value] ?? VALUE_LABELS[value] ?? String(value);
}

const NAV_GROUPS = [
  { label: 'Pilotage', views: ['start', 'dashboard'] },
  { label: 'Recherche', views: ['products', 'competitors', 'suppliers'] },
  { label: 'Construction', views: ['storefronts', 'deliverables'] },
  { label: 'Croissance', views: ['creatives', 'campaigns'] },
  { label: 'Suivi', views: ['tasks', 'metrics'] }
];

// --- État ------------------------------------------------------------------

const state = {
  schema: null,
  data: null,
  view: 'start',
  filters: {},
  loaded: false
};

let dialogBusy = false;

// --- Réseau ----------------------------------------------------------------

async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = new Error(parsed?.error ?? `Erreur ${res.status}.`);
    err.status = res.status;
    err.field = parsed?.field ?? null;
    throw err;
  }
  return parsed;
}

function setSaveState(kind, label) {
  const node = $('save-state');
  node.dataset.state = kind;
  node.textContent = label;
}

let toastTimer = null;
function toast(message, kind = 'info') {
  const node = $('toast');
  node.textContent = message;
  node.dataset.kind = kind;
  node.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 4200);
}

/** Écriture : invalide le cycle de sondage en vol, puis recharge l'état. */
async function mutate(fn, successMessage) {
  live.invalidate();
  setSaveState('saving', 'Enregistrement…');
  try {
    const result = await fn();
    await reload();
    setSaveState('saved', 'Enregistré');
    if (successMessage) toast(successMessage);
    return result;
  } catch (err) {
    setSaveState('error', 'Échec');
    throw err;
  }
}

async function reload() {
  const key = await live.readKey();
  const [schema, data] = await Promise.all([
    state.schema ? Promise.resolve(state.schema) : api('/api/schema'),
    api('/api/state')
  ]);
  state.schema = schema;
  state.data = data;
  state.loaded = true;
  render();
  if (key) live.adopt(key);
}

// --- Formatage -------------------------------------------------------------

function currency() {
  return state.data?.profile?.currency ?? 'EUR';
}

function money(value) {
  const num = Number(value ?? 0);
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency() }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency()}`;
  }
}

function shortDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('fr-FR');
}

function productName(id) {
  if (!id) return '—';
  return state.data.products.find((p) => p.id === id)?.name ?? '(produit supprimé)';
}

function fieldDef(collection, name) {
  return state.schema.collections[collection]?.fields.find((f) => f.name === name) ?? null;
}

/** Valeur d'un champ prête à l'affichage, selon son type déclaré. */
function displayValue(collection, record, name) {
  if (name === 'createdAt' || name === 'updatedAt') return shortDate(record[name]);
  const def = fieldDef(collection, name);
  const raw = record[name];
  if (!def) return raw === null || raw === undefined ? '—' : String(raw);
  switch (def.type) {
    case 'money':
      return money(raw);
    case 'ref':
      return productName(raw);
    case 'enum':
      return valueLabel(raw);
    case 'iso':
    case 'date':
      return shortDate(raw);
    case 'idlist':
      return raw.length === 0 ? '—' : raw.map(productName).join(', ');
    case 'int':
      return String(raw);
    default:
      return raw === '' || raw === null ? '—' : String(raw);
  }
}

// --- Navigation ------------------------------------------------------------

function viewLabel(view) {
  if (view === 'start') return 'Start Here';
  if (view === 'dashboard') return 'Cockpit';
  return state.schema.collections[view].label;
}

function renderNav() {
  const nav = clear($('nav'));
  for (const group of NAV_GROUPS) {
    nav.append(el('div', { class: 'nav-group', text: group.label }));
    for (const view of group.views) {
      const count = state.data[view]?.length;
      nav.append(
        el(
          'button',
          {
            type: 'button',
            'aria-current': state.view === view ? 'page' : null,
            onclick: () => {
              state.view = view;
              render();
            }
          },
          [el('span', { text: viewLabel(view) }), count === undefined ? null : el('span', { class: 'count', text: String(count) })]
        )
      );
    }
  }
}

// --- Champs de formulaire --------------------------------------------------

function inputFor(def, value) {
  value ??= def.default;
  const id = `f-${def.name}`;
  if (def.type === 'enum') {
    const select = el('select', { id, name: def.name });
    if (def.required !== true) select.append(el('option', { value: '', text: '—' }));
    for (const choice of def.choices) {
      select.append(el('option', { value: choice, text: valueLabel(choice), selected: value === choice }));
    }
    if (value) select.value = value;
    return select;
  }
  if (def.type === 'ref') {
    const select = el('select', { id, name: def.name });
    select.append(el('option', { value: '', text: 'Aucun produit lié' }));
    for (const product of state.data.products) {
      select.append(el('option', { value: product.id, text: product.name, selected: value === product.id }));
    }
    return select;
  }
  if (def.type === 'idlist') {
    const box = el('ul', { class: 'checklist', id });
    if (state.data.products.length === 0) {
      box.append(el('p', { class: 'empty', text: 'Créez d’abord un produit pour pouvoir le rattacher.' }));
    }
    for (const product of state.data.products) {
      box.append(
        el('li', {}, [
          el('input', {
            type: 'checkbox',
            value: product.id,
            checked: (value ?? []).includes(product.id),
            dataset: { idlist: def.name }
          }),
          el('span', { text: product.name })
        ])
      );
    }
    return box;
  }
  if (def.type === 'money') {
    return el('input', { id, name: def.name, type: 'number', step: '0.01', min: '0', value: value ?? 0 });
  }
  if (def.type === 'int') {
    return el('input', { id, name: def.name, type: 'number', step: '1', min: String(def.min ?? 0), max: String(def.max ?? 1000), value: value ?? 0 });
  }
  if (def.type === 'url') {
    return el('input', { id, name: def.name, type: 'url', placeholder: 'https://…', value: value ?? '' });
  }
  if (def.type === 'date' || def.type === 'iso') {
    const raw = typeof value === 'string' ? value.slice(0, 10) : '';
    return el('input', { id, name: def.name, type: 'date', value: raw });
  }
  if (def.multiline) {
    return el('textarea', { id, name: def.name, value: value ?? '' });
  }
  return el('input', { id, name: def.name, type: 'text', maxLength: def.max ?? 400, value: value ?? '' });
}

function fieldBlock(def, value) {
  const control = inputFor(def, value);
  return el('div', { class: 'field' }, [
    el('label', { for: control.id, text: def.required === true ? `${def.label} *` : def.label }),
    control
  ]);
}

/** Relit les valeurs saisies dans un formulaire, par type déclaré. */
function readForm(form, fields) {
  const body = {};
  for (const def of fields) {
    if (def.type === 'idlist') {
      body[def.name] = [...form.querySelectorAll(`[data-idlist="${def.name}"]`)]
        .filter((node) => node.checked)
        .map((node) => node.value);
      continue;
    }
    const node = form.querySelector(`[name="${def.name}"]`);
    if (!node) continue;
    const raw = node.value;
    if (def.type === 'money' || def.type === 'int') body[def.name] = raw === '' ? 0 : Number(raw);
    else body[def.name] = raw;
  }
  return body;
}

// --- Dialogue --------------------------------------------------------------

function openDialog({ title, content, submitLabel, onSubmit, extraActions = [] }) {
  const dialog = $('dialog');
  clear(dialog);
  const error = el('p', { class: 'dialog-error', hidden: true });
  const form = el('form', { method: 'dialog', class: 'dialog-body' });
  const submit = el('button', { class: 'btn primary', type: 'submit', text: submitLabel });

  form.append(el('h2', { text: title }), content, error, el('div', { class: 'dialog-foot' }, [
    ...extraActions,
    el('button', { class: 'btn', type: 'button', text: 'Annuler', onclick: () => dialog.close() }),
    submit
  ]));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (dialogBusy) return;
    dialogBusy = true;
    submit.disabled = true;
    error.hidden = true;
    try {
      await onSubmit(form);
      dialog.close();
    } catch (err) {
      error.textContent = err.field ? `${err.message} (champ : ${err.field})` : err.message;
      error.hidden = false;
    } finally {
      dialogBusy = false;
      submit.disabled = false;
    }
  });

  dialog.append(form);
  dialog.showModal();
  const first = form.querySelector('input, select, textarea');
  if (first) first.focus();
  guard.capture(dialog);
  return dialog;
}

function confirmDialog(message, onConfirm) {
  openDialog({
    title: 'Confirmer',
    content: el('p', { text: message }),
    submitLabel: 'Supprimer',
    onSubmit: onConfirm
  });
}

// --- CRUD générique --------------------------------------------------------

function recordDialog(collection, record) {
  const def = state.schema.collections[collection];
  const fields = def.fields;
  const content = el('div', { class: 'stack' }, fields.map((f) => fieldBlock(f, record ? record[f.name] : undefined)));
  const extras = [];
  if (record) {
    extras.push(
      el('button', {
        class: 'btn danger',
        type: 'button',
        text: 'Supprimer',
        onclick: () => {
          $('dialog').close();
          confirmDialog(`Supprimer « ${titleOf(collection, record)} » ? Cette action est définitive.`, async () => {
            await mutate(() => api(`/api/${collection}/${record.id}`, { method: 'DELETE' }), 'Supprimé.');
          });
        }
      })
    );
  }
  openDialog({
    title: record ? `Modifier — ${def.singular}` : `Nouveau — ${def.singular}`,
    content,
    submitLabel: record ? 'Enregistrer' : 'Créer',
    extraActions: extras,
    onSubmit: async (form) => {
      const body = readForm(form, fields);
      await mutate(
        () =>
          record
            ? api(`/api/${collection}/${record.id}`, { method: 'PATCH', body })
            : api(`/api/${collection}`, { method: 'POST', body }),
        record ? 'Modifications enregistrées.' : `${def.singular} créé.`
      );
    }
  });
}

/** Premier champ texte obligatoire : sert de titre lisible partout. */
function titleField(collection) {
  return state.schema.collections[collection].fields.find((f) => f.type === 'text' && f.required)?.name ?? 'id';
}

function titleOf(collection, record) {
  const name = titleField(collection);
  return record[name] || '(sans titre)';
}

function matchesFilters(collection, record) {
  const filters = state.filters[collection] ?? {};
  const search = (filters.q ?? '').trim().toLowerCase();
  if (search !== '') {
    const haystack = state.schema.collections[collection].fields
      .filter((f) => f.type === 'text')
      .map((f) => String(record[f.name] ?? ''))
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'q' || value === '') continue;
    if (String(record[key] ?? '') !== value) return false;
  }
  return true;
}

/**
 * La barre de filtres n'est pas reconstruite à chaque frappe : seule la liste
 * l'est. Le champ de recherche garde donc son focus et son curseur.
 */
function filterBar(collection, onChange) {
  const def = state.schema.collections[collection];
  const filters = (state.filters[collection] ??= {});
  const bar = el('div', { class: 'filters' });
  bar.append(
    el('input', {
      type: 'search',
      value: filters.q ?? '',
      placeholder: 'Rechercher…',
      'aria-label': 'Rechercher',
      oninput: (event) => {
        filters.q = event.target.value;
        onChange();
      }
    })
  );
  for (const field of def.fields) {
    if (field.type !== 'enum' && field.type !== 'ref') continue;
    const select = el('select', {
      'aria-label': field.label,
      onchange: (event) => {
        filters[field.name] = event.target.value;
        onChange();
      }
    });
    select.append(el('option', { value: '', text: `${field.label} : tous` }));
    const choices = field.type === 'ref' ? state.data.products.map((p) => [p.id, p.name]) : field.choices.map((c) => [c, valueLabel(c)]);
    for (const [value, label] of choices) {
      select.append(el('option', { value, text: label, selected: filters[field.name] === value }));
    }
    bar.append(select);
  }
  return bar;
}

function recordCard(collection, record) {
  const def = state.schema.collections[collection];
  const badges = def.fields
    .filter((f) => f.type === 'enum')
    .map((f) => el('span', { class: `badge ${record[f.name]}`, text: valueLabel(record[f.name]) }));
  const facts = def.defaultColumns.filter((c) => c !== titleField(collection) && fieldDef(collection, c)?.type !== 'enum');
  return el('article', { class: 'record' }, [
    el('div', { class: 'record-head' }, [
      el('div', { class: 'record-title', text: titleOf(collection, record) }),
      el('div', { class: 'record-badges' }, badges)
    ]),
    facts.length === 0
      ? null
      : el(
          'dl',
          { class: 'record-facts' },
          facts.map((name) =>
            el('div', {}, [
              el('dt', { text: fieldDef(collection, name)?.label ?? name }),
              el('dd', { text: displayValue(collection, record, name) })
            ])
          )
        ),
    el('div', { class: 'record-foot' }, [
      el('button', { class: 'btn small', type: 'button', text: 'Ouvrir', onclick: () => recordDialog(collection, record) })
    ])
  ]);
}

function collectionView(collection) {
  const def = state.schema.collections[collection];
  const all = state.data[collection];
  const view = el('div', { class: 'stack' });
  const counter = el('p', { class: 'subtitle' });
  const listBox = el('div', { class: 'stack' });

  function refreshList() {
    const rows = all.filter((r) => matchesFilters(collection, r));
    counter.textContent = `${rows.length} sur ${all.length} enregistrement(s)`;
    clear(listBox).append(
      rows.length === 0
        ? el('p', { class: 'empty', text: all.length === 0 ? 'Rien enregistré pour l’instant.' : 'Aucun résultat pour ce filtre.' })
        : el('div', { class: 'records' }, rows.map((r) => recordCard(collection, r)))
    );
  }

  view.append(
    el('div', { class: 'page-head' }, [
      el('div', {}, [el('h1', { text: def.label }), counter]),
      el('div', { class: 'actions' }, [
        el('button', {
          class: 'btn primary',
          type: 'button',
          text: `Nouveau ${def.singular.toLowerCase()}`,
          onclick: () => recordDialog(collection, null)
        })
      ])
    ])
  );

  if (collection === 'products') view.append(pipelineCard('products', 'status', 'Pipeline produits'));
  if (collection === 'metrics') view.append(metricsSummary());
  if (collection === 'competitors') {
    view.append(
      el('p', {
        class: 'note',
        text:
          'Une publicité active observée est une observation datée, pas une preuve de rentabilité. ' +
          'Notez la source et la date dans « Observation », et gardez vos conclusions séparées des faits.'
      })
    );
  }

  view.append(filterBar(collection, refreshList));
  view.append(listBox);
  refreshList();
  return view;
}

// --- Blocs réutilisés ------------------------------------------------------

function pipelineCard(collection, groupBy, title) {
  const def = state.schema.collections[collection];
  const field = def.fields.find((f) => f.name === groupBy);
  const board = el('div', { class: 'pipeline' });
  for (const choice of field.choices) {
    const items = state.data[collection].filter((r) => r[groupBy] === choice);
    board.append(
      el('div', { class: 'pipeline-col' }, [
        el('h3', {}, [el('span', { text: valueLabel(choice) }), el('span', { class: 'muted', text: String(items.length) })]),
        items.length === 0
          ? el('p', { class: 'muted small', text: '—' })
          : el(
              'ul',
              {},
              items.slice(0, 12).map((item) =>
                el('li', {}, [
                  el('button', {
                    class: 'link',
                    type: 'button',
                    text: titleOf(collection, item),
                    onclick: () => recordDialog(collection, item)
                  })
                ])
              )
            )
      ])
    );
  }
  return el('section', { class: 'card' }, [el('h2', { text: title }), board]);
}

function metricsTotals() {
  return state.data.metrics.reduce(
    (acc, row) => ({
      spend: acc.spend + row.spend,
      revenue: acc.revenue + row.revenue,
      orders: acc.orders + row.orders,
      returns: acc.returns + row.returns
    }),
    { spend: 0, revenue: 0, orders: 0, returns: 0 }
  );
}

function metricsSummary(title = 'Relevés saisis') {
  const totals = metricsTotals();
  const count = state.data.metrics.length;
  return el('section', { class: 'card' }, [
    el('h2', { text: title }),
    count === 0
      ? el('p', { class: 'empty', text: 'Aucun relevé. Les chiffres ci-dessous restent vides tant que rien n’est saisi.' })
      : el('div', { class: 'grid' }, [
          el('div', { class: 'kpi' }, [el('b', { text: money(totals.spend) }), el('span', { text: 'Dépense publicitaire' })]),
          el('div', { class: 'kpi' }, [el('b', { text: money(totals.revenue) }), el('span', { text: 'Chiffre d’affaires' })]),
          el('div', { class: 'kpi' }, [el('b', { text: String(totals.orders) }), el('span', { text: 'Commandes' })]),
          el('div', { class: 'kpi' }, [el('b', { text: String(totals.returns) }), el('span', { text: 'Retours' })]),
          el('div', { class: 'kpi' }, [
            el('b', { text: money(totals.revenue - totals.spend) }),
            el('span', { text: 'Écart chiffre d’affaires − dépense' })
          ])
        ]),
    el('p', {
      class: 'subtitle',
      text: `${count} relevé(s), saisis manuellement. Cet écart n’est pas une marge : coûts produit, logistique et frais de paiement n’y sont pas soustraits.`
    })
  ]);
}

function dataTable(collection, columns, rows) {
  const cols = columns.length > 0 ? columns : state.schema.collections[collection].defaultColumns;
  const table = el('table', { class: 'data-table' });
  table.append(
    el('thead', {}, [
      el(
        'tr',
        {},
        cols.map((c) => el('th', { text: fieldDef(collection, c)?.label ?? c }))
      )
    ])
  );
  table.append(
    el(
      'tbody',
      {},
      rows.map((row) =>
        el(
          'tr',
          {},
          cols.map((c) =>
            el('td', {
              text: displayValue(collection, row, c),
              dataset: { label: fieldDef(collection, c)?.label ?? c }
            })
          )
        )
      )
    )
  );
  return table;
}

// --- Vue « Start Here » ----------------------------------------------------

function startView() {
  const profile = state.data.profile;
  const fields = state.schema.profile.fields;
  const form = el('form', { class: 'stack' });
  form.append(el('div', { class: 'field-row' }, fields.map((f) => fieldBlock(f, profile[f.name]))));
  form.append(
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn primary', type: 'submit', text: 'Enregistrer le profil' }),
      el('span', {
        class: 'subtitle',
        text: profile.updatedAt ? `Dernière mise à jour : ${shortDate(profile.updatedAt)}` : 'Jamais enregistré'
      })
    ])
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await mutate(() => api('/api/profile', { method: 'PUT', body: readForm(form, fields) }), 'Profil enregistré.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const stages = state.schema.workflow.map((entry) => {
    const tasks = state.data.tasks.filter((t) => t.stage === entry.stage);
    const open = tasks.filter((t) => t.status !== 'done').length;
    return el('li', {}, [
      el('strong', { text: entry.label }),
      el('span', { class: 'muted small', text: ` — ${tasks.length} tâche(s), ${open} ouverte(s)` })
    ]);
  });

  return el('div', { class: 'stack' }, [
    el('div', { class: 'page-head' }, [
      el('div', {}, [
        el('h1', { text: 'Start Here' }),
        el('p', {
          class: 'subtitle',
          text: 'Configurez votre activité, connectez votre modèle dans BizOS, puis confiez une première recherche produit à votre équipe.'
        })
      ])
    ]),
    el('section', { class: 'card' }, [el('h2', { text: 'Profil du business' }), form]),
    el('section', { class: 'card' }, [
      el('h2', { text: 'Brancher vos modèles et vos outils' }),
      el('ol', { class: 'steps' }, [
        el('li', {
          text: 'Dans les réglages de BizOS local, connectez votre compte Claude, Codex ou Cursor et choisissez le modèle de votre équipe.'
        }),
        el('li', {
          text: 'Dans Discussions, ouvrez votre équipe E-commerce. Décrivez votre marché, votre budget et vos idées de produits. Les agents disposent des méthodes et skills du template.'
        }),
        el('li', {
          text: 'Demandez : « Recherche trois pistes de produits, indique tes sources et tes hypothèses, puis enregistre les dossiers et les prochaines tâches dans mon dashboard. »'
        }),
        el('li', { text: 'À l’étape boutique ou acquisition, connectez vos propres comptes Shopify, publicitaires ou email avec votre agent. Il vous indiquera les accès nécessaires avant les actions sur ces services.' })
      ])
    ]),
    el('section', { class: 'card' }, [
      el('h2', { text: 'Les dix étapes' }),
      el('ul', { class: 'checklist' }, stages),
      el('p', { class: 'subtitle', text: 'Chaque tâche et chaque livrable porte une de ces étapes.' })
    ]),
    el('section', { class: 'card' }, [
      el('h2', { text: 'Données' }),
      el('div', { class: 'actions' }, [
        el('a', { class: 'btn', href: '/api/export', text: 'Exporter (JSON)' }),
        el('button', { class: 'btn', type: 'button', text: 'Importer un export', onclick: importDialog })
      ]),
      el('p', {
        class: 'subtitle',
        text: 'L’import vérifie le fichier puis remplace les fiches actuelles. Exportez une sauvegarde avant de restaurer un autre jeu de données.'
      })
    ])
  ]);
}

function importDialog() {
  const field = el('textarea', { name: 'payload', placeholder: '{ "version": 1, … }' });
  openDialog({
    title: 'Importer un export',
    content: el('div', { class: 'stack' }, [
      el('p', {
        class: 'note',
        text: 'Le contenu actuel des neuf collections sera remplacé. Exportez d’abord si vous voulez le conserver.'
      }),
      el('div', { class: 'field' }, [el('label', { text: 'Contenu du fichier JSON' }), field])
    ]),
    submitLabel: 'Importer',
    onSubmit: async () => {
      let parsed;
      try {
        parsed = JSON.parse(field.value);
      } catch {
        const err = new Error('JSON invalide : collez le contenu exact du fichier exporté.');
        throw err;
      }
      await mutate(() => api('/api/import', { method: 'POST', body: parsed }), 'Import terminé.');
    }
  });
}

// --- Vue « Cockpit » (configuration déclarative) ---------------------------

function dashboardView() {
  const config = state.data.dashboard;
  const view = el('div', { class: 'stack' });
  view.append(
    el('div', { class: 'page-head' }, [
      el('div', {}, [el('h1', { text: config.title }), config.intro ? el('p', { class: 'subtitle', text: config.intro }) : null]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn', type: 'button', text: 'Configurer', onclick: dashboardConfigDialog })
      ])
    ])
  );
  if (config.sections.length === 0) {
    view.append(el('p', { class: 'empty', text: 'Aucune section. Utilisez « Configurer » pour en ajouter.' }));
  }
  for (const section of config.sections) view.append(renderSection(section));
  return view;
}

function renderSection(section) {
  if (section.type === 'note') {
    return el('section', { class: 'card' }, [el('h2', { text: section.title }), el('p', { text: section.text })]);
  }
  if (section.type === 'metrics') return metricsSummary(section.title);
  if (section.type === 'pipeline') return pipelineCard(section.collection, section.groupBy, section.title);
  if (section.type === 'checklist') {
    return el('section', { class: 'card' }, [
      el('h2', { text: section.title }),
      section.items.length === 0
        ? el('p', { class: 'empty', text: 'Checklist vide.' })
        : el(
            'ul',
            { class: 'checklist' },
            section.items.map((item, index) =>
              el('li', {}, [
                el('input', {
                  type: 'checkbox',
                  checked: item.done,
                  'aria-label': item.label,
                  onchange: async (event) => {
                    const checked = event.target.checked;
                    try {
                      await mutate(() => {
                        const next = structuredClone(state.data.dashboard);
                        const target = next.sections.find((s) => s.id === section.id);
                        if (!target || !target.items[index]) throw new Error('Section modifiée ailleurs : rechargez.');
                        target.items[index].done = checked;
                        return api('/api/dashboard', { method: 'PUT', body: next });
                      });
                    } catch (err) {
                      toast(err.message, 'error');
                      render();
                    }
                  }
                }),
                el('span', { class: item.done ? 'done' : null, text: item.label })
              ])
            )
          )
    ]);
  }
  // type === 'collection'
  let rows = state.data[section.collection];
  if (section.filter) rows = rows.filter((r) => r[section.filter.field] === section.filter.value);
  rows = rows.slice(0, section.limit);
  return el('section', { class: 'card' }, [
    el('h2', { text: section.title }),
    rows.length === 0
      ? el('p', { class: 'empty', text: 'Aucun enregistrement.' })
      : dataTable(section.collection, section.columns, rows)
  ]);
}

function dashboardConfigDialog() {
  const draft = structuredClone(state.data.dashboard);
  const body = el('div', { class: 'stack' });

  const titleInput = el('input', { type: 'text', name: 'title', value: draft.title, maxLength: 120 });
  const introInput = el('textarea', { name: 'intro', value: draft.intro });
  const sectionsBox = el('div', { class: 'stack' });

  function newSection(type) {
    const id = `section-${Math.random().toString(36).slice(2, 8)}`;
    if (type === 'note') return { id, type, title: 'Note', text: '' };
    if (type === 'metrics') return { id, type, title: 'Relevés saisis' };
    if (type === 'checklist') return { id, type, title: 'Checklist', items: [] };
    if (type === 'pipeline') return { id, type, title: 'Pipeline produits', collection: 'products', groupBy: 'status' };
    return { id, type: 'collection', title: 'Tableau', collection: 'products', columns: [], limit: 50, filter: null };
  }

  function redraw() {
    clear(sectionsBox);
    draft.sections.forEach((section, index) => {
      const card = el('div', { class: 'card stack' });
      card.append(
        el('div', { class: 'row-between' }, [
          el('strong', { text: `${index + 1}. ${sectionTypeLabel(section.type)}` }),
          el('div', { class: 'actions' }, [
            el('button', {
              class: 'btn small',
              type: 'button',
              text: '↑',
              'aria-label': 'Monter',
              disabled: index === 0,
              onclick: () => {
                [draft.sections[index - 1], draft.sections[index]] = [draft.sections[index], draft.sections[index - 1]];
                redraw();
              }
            }),
            el('button', {
              class: 'btn small',
              type: 'button',
              text: '↓',
              'aria-label': 'Descendre',
              disabled: index === draft.sections.length - 1,
              onclick: () => {
                [draft.sections[index + 1], draft.sections[index]] = [draft.sections[index], draft.sections[index + 1]];
                redraw();
              }
            }),
            el('button', {
              class: 'btn small danger',
              type: 'button',
              text: 'Retirer',
              onclick: () => {
                draft.sections.splice(index, 1);
                redraw();
              }
            })
          ])
        ])
      );
      card.append(
        el('div', { class: 'field' }, [
          el('label', { text: 'Titre affiché' }),
          el('input', {
            type: 'text',
            value: section.title,
            maxLength: 120,
            oninput: (event) => {
              section.title = event.target.value;
            }
          })
        ])
      );
      card.append(...sectionEditor(section, redraw));
      sectionsBox.append(card);
    });
  }

  const addSelect = el('select', { 'aria-label': 'Type de section' });
  for (const type of state.schema.dashboard.sectionTypes) {
    addSelect.append(el('option', { value: type, text: sectionTypeLabel(type) }));
  }

  body.append(
    el('div', { class: 'field' }, [el('label', { text: 'Titre du cockpit' }), titleInput]),
    el('div', { class: 'field' }, [el('label', { text: 'Introduction' }), introInput]),
    el('h3', { text: 'Sections' }),
    sectionsBox,
    el('div', { class: 'actions' }, [
      addSelect,
      el('button', {
        class: 'btn',
        type: 'button',
        text: 'Ajouter',
        onclick: () => {
          if (draft.sections.length >= state.schema.dashboard.maxSections) {
            toast(`Maximum ${state.schema.dashboard.maxSections} sections.`, 'error');
            return;
          }
          draft.sections.push(newSection(addSelect.value));
          redraw();
        }
      })
    ]),
    el('p', {
      class: 'subtitle',
      text: 'Configuration déclarative : titres, sections et colonnes. Aucun code n’est exécuté par cette page.'
    })
  );
  redraw();

  openDialog({
    title: 'Configurer le cockpit',
    content: body,
    submitLabel: 'Enregistrer',
    onSubmit: async () => {
      draft.title = titleInput.value;
      draft.intro = introInput.value;
      await mutate(() => api('/api/dashboard', { method: 'PUT', body: draft }), 'Cockpit mis à jour.');
    }
  });
}

function sectionTypeLabel(type) {
  return (
    {
      note: 'Note',
      collection: 'Tableau',
      pipeline: 'Pipeline',
      metrics: 'Relevés',
      checklist: 'Checklist'
    }[type] ?? type
  );
}

function selectField(label, options, value, onChange) {
  const select = el('select', { onchange: (event) => onChange(event.target.value) });
  for (const [optValue, optLabel] of options) {
    select.append(el('option', { value: optValue, text: optLabel, selected: optValue === value }));
  }
  return el('div', { class: 'field' }, [el('label', { text: label }), select]);
}

function sectionEditor(section, redraw) {
  if (section.type === 'metrics') {
    return [el('p', { class: 'subtitle', text: 'Totaux calculés depuis la collection Métriques.' })];
  }
  if (section.type === 'note') {
    return [
      el('div', { class: 'field' }, [
        el('label', { text: 'Texte' }),
        el('textarea', {
          value: section.text,
          oninput: (event) => {
            section.text = event.target.value;
          }
        })
      ])
    ];
  }
  if (section.type === 'checklist') {
    const list = el('div', { class: 'stack' });
    section.items.forEach((item, index) => {
      list.append(
        el('div', { class: 'row-between' }, [
          el('input', {
            type: 'text',
            value: item.label,
            maxLength: 200,
            oninput: (event) => {
              item.label = event.target.value;
            }
          }),
          el('button', {
            class: 'btn small danger',
            type: 'button',
            text: '✕',
            'aria-label': 'Retirer la ligne',
            onclick: () => {
              section.items.splice(index, 1);
              redraw();
            }
          })
        ])
      );
    });
    list.append(
      el('button', {
        class: 'btn small',
        type: 'button',
        text: 'Ajouter une ligne',
        onclick: () => {
          section.items.push({ label: 'Nouvelle étape', done: false });
          redraw();
        }
      })
    );
    return [list];
  }
  if (section.type === 'pipeline') {
    const collections = state.schema.dashboard.pipelineCollections.map((c) => [c, state.schema.collections[c].label]);
    const groups = state.schema.collections[section.collection].fields
      .filter((f) => f.type === 'enum')
      .map((f) => [f.name, f.label]);
    return [
      selectField('Collection', collections, section.collection, (value) => {
        section.collection = value;
        section.groupBy = state.schema.collections[value].fields.find((f) => f.type === 'enum').name;
        redraw();
      }),
      selectField('Grouper par', groups, section.groupBy, (value) => {
        section.groupBy = value;
      })
    ];
  }

  // collection
  const collections = Object.entries(state.schema.collections).map(([name, def]) => [name, def.label]);
  const def = state.schema.collections[section.collection];
  const columnsBox = el('ul', { class: 'checklist' });
  for (const field of def.fields) {
    columnsBox.append(
      el('li', {}, [
        el('input', {
          type: 'checkbox',
          checked: section.columns.includes(field.name),
          onchange: (event) => {
            if (event.target.checked) section.columns.push(field.name);
            else section.columns = section.columns.filter((c) => c !== field.name);
          }
        }),
        el('span', { text: field.label })
      ])
    );
  }
  const enums = def.fields.filter((f) => f.type === 'enum');
  const filterField = section.filter?.field ?? '';
  const editors = [
    selectField('Collection', collections, section.collection, (value) => {
      section.collection = value;
      section.columns = [];
      section.filter = null;
      redraw();
    }),
    el('div', { class: 'field' }, [
      el('label', { text: `Colonnes (max ${state.schema.limits.columns}, vide = colonnes par défaut)` }),
      columnsBox
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Lignes affichées' }),
      el('input', {
        type: 'number',
        min: '1',
        max: '200',
        value: section.limit,
        oninput: (event) => {
          section.limit = Number(event.target.value);
        }
      })
    ])
  ];
  if (enums.length > 0) {
    editors.push(
      selectField(
        'Filtre',
        [['', 'Aucun'], ...enums.map((f) => [f.name, f.label])],
        filterField,
        (value) => {
          section.filter = value === '' ? null : { field: value, value: state.schema.collections[section.collection].fields.find((f) => f.name === value).choices[0] };
          redraw();
        }
      )
    );
    if (section.filter) {
      const choices = def.fields.find((f) => f.name === section.filter.field).choices.map((c) => [c, valueLabel(c)]);
      editors.push(
        selectField('Valeur du filtre', choices, section.filter.value, (value) => {
          section.filter.value = value;
        })
      );
    }
  }
  return editors;
}

// --- Rendu -----------------------------------------------------------------

function renderView() {
  const container = clear($('view'));
  if (!state.loaded) {
    container.append(el('p', { class: 'empty', text: 'Chargement…' }));
    return;
  }
  if (state.view === 'start') container.append(startView());
  else if (state.view === 'dashboard') container.append(dashboardView());
  else container.append(collectionView(state.view));
  guard.capture(container);
}

function render() {
  renderNav();
  renderView();
}

// --- Rafraîchissement ------------------------------------------------------

const guard = createInputGuard();

const live = createLiveRefresh({
  readMeta: () => api('/api/meta'),
  readState: () => api('/api/state'),
  applyState: async (data) => {
    state.data = data;
    render();
  },
  // Ne jamais écraser une saisie : formulaire en cours ou fenêtre ouverte.
  isBusy: () => $('dialog').open || guard.isDirty($('view')),
  onNotice: (notice) => {
    const bar = $('live-bar');
    if (notice === null) {
      if (bar.dataset.kind !== 'offline') bar.hidden = true;
      return;
    }
    bar.dataset.kind = 'changed';
    $('live-text').textContent = 'Les données ont changé ailleurs. Votre saisie est conservée.';
    $('live-action').hidden = false;
    bar.hidden = false;
  },
  onStatus: ({ online }) => {
    const bar = $('live-bar');
    if (online) {
      bar.hidden = true;
      delete bar.dataset.kind;
      return;
    }
    bar.dataset.kind = 'offline';
    $('live-text').textContent = 'Serveur injoignable. Les modifications ne sont pas enregistrées.';
    $('live-action').hidden = false;
    bar.hidden = false;
  }
});

$('live-action').addEventListener('click', () => live.reloadNow());
document.addEventListener('visibilitychange', () => live.setVisible(!document.hidden));
window.addEventListener('focus', () => live.wake());

// --- Ouverture depuis l'application hôte -----------------------------------

/**
 * Le ticket arrive dans le fragment `#connect=`. Il est lu puis effacé de la
 * barre d'adresse et de l'historique AVANT tout appel réseau : il ne peut donc
 * pas fuiter par un Referer, un partage d'URL ou un rechargement.
 */
async function redeemTicketFromHash() {
  const match = /(?:^|[#&])connect=([0-9a-f]{64})(?:&|$)/.exec(window.location.hash ?? '');
  if (!match) return;
  const ticket = match[1];
  history.replaceState(null, '', window.location.pathname + window.location.search);
  await api('/api/session', { method: 'POST', body: { ticket } });
}

async function boot() {
  try {
    await redeemTicketFromHash();
  } catch {
    // Ticket expiré ou déjà utilisé : le chargement suivant montrera l'erreur d'accès.
  }
  try {
    const meta = await api('/api/meta');
    if (meta.hostedBy === 'bizos-local') $('host-label').textContent = 'ouvert depuis BizOS local';
    await reload();
    live.start();
  } catch (err) {
    clear($('view')).append(
      el('section', { class: 'card' }, [
        el('h1', { text: 'Accès impossible' }),
        el('p', { text: err.message }),
        el('p', {
          class: 'subtitle',
          text: 'Rouvrez ce cockpit depuis son application hôte pour obtenir une session, ou lancez-le en mode autonome.'
        })
      ])
    );
    setSaveState('error', 'Hors ligne');
  }
}

boot();
