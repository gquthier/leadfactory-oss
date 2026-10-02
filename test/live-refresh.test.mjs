// Boucle de synchronisation de la page ouverte (public/live-refresh.js).
// Module pur : minuterie et réseau sont simulés, aucun DOM requis.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createInputGuard, createLiveRefresh, isTypingIn, metaKey } from '../public/live-refresh.js';

/** Faux DOM minimal : juste ce que la garde de saisie interroge. */
function fakeField(props) {
  return { tagName: 'INPUT', type: 'text', value: '', checked: false, ...props };
}

function fakeRoot(fields) {
  return { querySelectorAll: () => fields };
}

/** Minuterie manuelle : on décide quand le prochain sondage part. */
function fakeClock() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    get armed() {
      return timers.size;
    },
    delays() {
      return [...timers.values()].map((t) => t.ms);
    },
    /** Déclenche la minuterie en attente et rend la promesse du cycle. */
    async fire() {
      const [id, timer] = [...timers.entries()][0] ?? [];
      assert.ok(timer, 'aucune minuterie armée');
      timers.delete(id);
      return timer.fn();
    }
  };
}

/** Serveur simulé : révision et données pilotées par le test. */
function fakeServer(initial = { revision: 'r1', data: { clients: [] } }) {
  const server = {
    instanceId: 'i1',
    revision: initial.revision,
    data: initial.data,
    metaCalls: 0,
    stateCalls: 0,
    metaFails: 0,
    gate: null,
    async readMeta() {
      server.metaCalls += 1;
      if (server.metaFails > 0) {
        server.metaFails -= 1;
        throw new Error('réseau');
      }
      return { product: 'leadfactory-oss', apiVersion: 1, revision: server.revision, instanceId: server.instanceId };
    },
    async readState() {
      server.stateCalls += 1;
      if (server.gate) await server.gate;
      return server.data;
    },
    mutate(revision, data) {
      server.revision = revision;
      server.data = data;
    }
  };
  return server;
}

function harness(overrides = {}) {
  const clock = fakeClock();
  const server = fakeServer();
  const applied = [];
  const notices = [];
  const statuses = [];
  let busy = false;
  const live = createLiveRefresh({
    readMeta: () => server.readMeta(),
    readState: () => server.readState(),
    applyState: async (data) => {
      applied.push(data);
    },
    isBusy: () => busy,
    onNotice: (n) => notices.push(n),
    onStatus: (s) => statuses.push({ ...s }),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    interval: 3000,
    ...overrides
  });
  return {
    live,
    clock,
    server,
    applied,
    notices,
    statuses,
    setBusy(v) {
      busy = v;
    }
  };
}

test('la garde repère un brouillon modifié, y compris hors fenêtre modale', () => {
  const guard = createInputGuard();
  const texte = fakeField({ value: 'Acme' });
  const zone = fakeField({ tagName: 'TEXTAREA', type: undefined, value: 'notes' });
  const choix = fakeField({ tagName: 'SELECT', type: 'select-one', value: 'cold-email' });
  const coche = fakeField({ type: 'checkbox', checked: false });
  const editeurEnLigne = fakeRoot([texte, zone, choix, coche]);

  guard.capture(editeurEnLigne);
  assert.equal(guard.isDirty(editeurEnLigne), false, 'aucun champ touché après le rendu');

  zone.value = 'notes en cours de rédaction';
  assert.equal(guard.isDirty(editeurEnLigne), true);

  zone.value = 'notes';
  assert.equal(guard.isDirty(editeurEnLigne), false);

  // Un simple choix dans un menu non enregistré compte aussi comme brouillon.
  choix.value = 'meta';
  assert.equal(guard.isDirty(editeurEnLigne), true);
  choix.value = 'cold-email';

  coche.checked = true;
  assert.equal(guard.isDirty(editeurEnLigne), true);

  // Nouveau rendu : la nouvelle valeur devient la référence.
  guard.capture(editeurEnLigne);
  assert.equal(guard.isDirty(editeurEnLigne), false);

  // Un champ apparu après le rendu n'invente pas un brouillon.
  assert.equal(guard.isDirty(fakeRoot([...[texte], fakeField({ value: 'neuf' })])), false);
  assert.equal(guard.isDirty(null), false);
});

test('isTypingIn distingue la saisie libre des commandes et du filtre de recherche', () => {
  assert.equal(isTypingIn(fakeField({ type: 'text' })), true);
  assert.equal(isTypingIn(fakeField({ type: 'email' })), true);
  assert.equal(isTypingIn(fakeField({ type: 'number' })), true);
  assert.equal(isTypingIn(fakeField({ tagName: 'TEXTAREA' })), true);
  assert.equal(isTypingIn({ tagName: 'DIV', isContentEditable: true }), true);

  assert.equal(isTypingIn(fakeField({ type: 'search' })), false, 'le filtre est reconstruit depuis l\'état');
  assert.equal(isTypingIn(fakeField({ type: 'checkbox' })), false);
  assert.equal(isTypingIn(fakeField({ type: 'submit' })), false);
  assert.equal(isTypingIn({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingIn({ tagName: 'SELECT', type: 'select-one' }), false);
  assert.equal(isTypingIn(null), false);
});

test('metaKey combine instance et révision, et rejette une réponse inutilisable', () => {
  assert.equal(metaKey({ instanceId: 'i1', revision: 'r1' }), 'i1:r1');
  assert.equal(metaKey({ revision: 'r1' }), ':r1');
  assert.equal(metaKey({ instanceId: 'i1' }), null);
  assert.equal(metaKey({ instanceId: 'i1', revision: '' }), null);
  assert.equal(metaKey(null), null);
});

test('révision inchangée : aucun rechargement de l\'état', async () => {
  const h = harness();
  h.live.adopt('i1:r1');
  h.live.start();

  await h.clock.fire();
  await h.clock.fire();

  assert.equal(h.server.metaCalls, 2);
  assert.equal(h.server.stateCalls, 0, 'seule /api/meta est sondée');
  assert.equal(h.applied.length, 0);
  assert.equal(h.clock.armed, 1, 'exactement une minuterie réarmée');
});

test('révision distante différente : l\'état est rechargé puis adopté', async () => {
  const h = harness();
  h.live.adopt('i1:r1');
  h.live.start();

  h.server.mutate('r2', { clients: [{ id: 'c1' }] });
  await h.clock.fire();

  assert.deepEqual(h.applied, [{ clients: [{ id: 'c1' }] }]);
  assert.equal(h.live.status().appliedKey, 'i1:r2');

  // Sondage suivant : plus rien à faire.
  await h.clock.fire();
  assert.equal(h.server.stateCalls, 1);
  assert.equal(h.applied.length, 1);
});

test('la révision n\'est adoptée qu\'après un rendu réussi', async () => {
  const h = harness({
    applyState: async () => {
      throw new Error('rendu impossible');
    }
  });
  h.live.adopt('i1:r1');
  h.live.start();
  h.server.mutate('r2', { clients: [] });

  assert.equal(await h.clock.fire(), 'apply-failed');
  assert.equal(h.live.status().appliedKey, 'i1:r1', 'révision non absorbée');
  assert.equal(h.live.status().online, true, 'un échec de rendu n\'est pas une panne réseau');

  // Le cycle suivant retentera le même changement.
  assert.equal(await h.clock.fire(), 'apply-failed');
  assert.equal(h.server.stateCalls, 2);
});

test('saisie en cours : avis discret, aucune donnée écrasée, rechargement explicite', async () => {
  const h = harness();
  h.live.adopt('i1:r1');
  h.live.start();
  h.setBusy(true);
  h.server.mutate('r2', { clients: [{ id: 'c1' }] });

  assert.equal(await h.clock.fire(), 'deferred');
  assert.equal(h.applied.length, 0, 'le brouillon n\'est pas remplacé');
  assert.equal(h.server.stateCalls, 0, 'inutile de télécharger un état qu\'on n\'appliquera pas');
  assert.deepEqual(h.notices, [{ revision: 'i1:r2' }]);
  assert.equal(h.live.status().appliedKey, 'i1:r1');

  // Tant que la révision distante ne bouge pas, l'avis n'est pas répété.
  await h.clock.fire();
  assert.equal(h.notices.length, 1);

  // Action explicite de l'utilisateur : on recharge malgré la saisie.
  assert.equal(await h.live.reloadNow(), 'applied');
  assert.deepEqual(h.applied, [{ clients: [{ id: 'c1' }] }]);
  assert.equal(h.live.status().appliedKey, 'i1:r2');
  assert.deepEqual(h.notices.at(-1), null, 'avis retiré une fois les données affichées');
});

test('saisie commencée pendant la requête d\'état : avis au lieu d\'un écrasement', async () => {
  const h = harness();
  h.live.adopt('i1:r1');
  h.live.start();
  h.server.mutate('r2', { clients: [{ id: 'c1' }] });

  let release;
  h.server.gate = new Promise((resolve) => {
    release = resolve;
  });
  const cycle = h.clock.fire();
  await Promise.resolve();
  h.setBusy(true); // l'utilisateur clique dans un champ pendant le transfert
  release();

  assert.equal(await cycle, 'deferred');
  assert.equal(h.applied.length, 0);
  assert.deepEqual(h.notices, [{ revision: 'i1:r2' }]);
});

test('aucune requête empilée : un cycle en vol bloque les suivants', async () => {
  const h = harness();
  h.live.adopt('i1:r1');
  h.live.start();
  h.server.mutate('r2', { clients: [] });

  let release;
  h.server.gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = h.clock.fire();
  await Promise.resolve();

  assert.equal(await h.live.wake(), 'inflight');
  assert.equal(await h.live.wake(), 'inflight');
  assert.equal(h.server.metaCalls, 1);
  assert.equal(h.server.stateCalls, 1);

  release();
  assert.equal(await first, 'applied');
  assert.equal(h.server.metaCalls, 1, 'les réveils ignorés n\'ont rien redemandé');
  assert.equal(h.clock.armed, 1, 'une seule minuterie, pas une par tentative');
});

test('un rechargement explicite demandé pendant un cycle en vol est rejoué', async () => {
  const h = harness();
  h.live.adopt('i1:r1');
  h.live.start();
  h.setBusy(true);
  h.server.mutate('r2', { clients: [{ id: 'c1' }] });

  let release;
  h.server.gate = new Promise((resolve) => {
    release = resolve;
  });
  // Cycle en vol qui va différer (saisie en cours).
  h.server.gate = null;
  const first = h.clock.fire();
  assert.equal(await first, 'deferred');

  // Cette fois on bloque la lecture d'état et on clique « Recharger » pendant.
  h.server.gate = new Promise((resolve) => {
    release = resolve;
  });
  h.server.mutate('r3', { clients: [{ id: 'c1' }, { id: 'c2' }] });
  h.setBusy(false);
  const pending = h.clock.fire();
  await Promise.resolve();
  assert.equal(await h.live.reloadNow(), 'inflight', 'aucune requête empilée');
  release();

  await pending;
  assert.equal(h.server.metaCalls, 3, 'le clic différé a bien été rejoué après le cycle en vol');
  assert.deepEqual(h.applied.at(-1), { clients: [{ id: 'c1' }, { id: 'c2' }] });
  assert.equal(h.live.status().appliedKey, 'i1:r3');
  assert.equal(h.live.status().inFlight, false);
});

test('coupure réseau : indicateur unique, recul progressif, puis reprise', async () => {
  const h = harness();
  h.live.adopt('i1:r1');
  h.live.start();
  h.server.metaFails = 3;

  assert.equal(await h.clock.fire(), 'error');
  assert.deepEqual(h.statuses, [{ online: false, failures: 1 }]);
  assert.deepEqual(h.clock.delays(), [6000]);

  assert.equal(await h.clock.fire(), 'error');
  assert.equal(h.statuses.length, 1, 'pas de message répété à chaque échec');
  assert.deepEqual(h.clock.delays(), [12000]);

  assert.equal(await h.clock.fire(), 'error');
  assert.deepEqual(h.clock.delays(), [24000]);

  // Le serveur répond de nouveau : reprise et retour à la cadence normale.
  h.server.mutate('r2', { clients: [{ id: 'c1' }] });
  assert.equal(await h.clock.fire(), 'applied');
  assert.deepEqual(h.statuses, [
    { online: false, failures: 1 },
    { online: true, failures: 0 }
  ]);
  assert.deepEqual(h.applied, [{ clients: [{ id: 'c1' }] }]);
  assert.deepEqual(h.clock.delays(), [3000]);
});

test('le recul est plafonné', async () => {
  const h = harness({ maxBackoff: 30000 });
  h.live.start();
  h.server.metaFails = 20;
  for (let i = 0; i < 8; i += 1) await h.clock.fire();
  assert.deepEqual(h.clock.delays(), [30000]);
});

test('page cachée : sondage suspendu, repris et vérifié au retour', async () => {
  const h = harness();
  h.live.adopt('i1:r1');
  h.live.start();
  assert.equal(h.clock.armed, 1);

  await h.live.setVisible(false);
  assert.equal(h.clock.armed, 0, 'aucune minuterie tant que la page est cachée');
  assert.equal(await h.live.wake(), 'idle');
  assert.equal(h.server.metaCalls, 0, 'rien n\'est sondé en arrière-plan');

  h.server.mutate('r2', { clients: [{ id: 'c1' }] });
  assert.equal(await h.live.setVisible(true), 'applied', 'vérification immédiate au retour');
  assert.deepEqual(h.applied, [{ clients: [{ id: 'c1' }] }]);
  assert.equal(h.clock.armed, 1);
});

test('mutation locale pendant un cycle : ni application périmée ni faux avis', async () => {
  const h = harness();
  h.live.adopt('i1:r1');
  h.live.start();
  h.server.mutate('r2', { clients: [{ id: 'stale' }] });

  let release;
  h.server.gate = new Promise((resolve) => {
    release = resolve;
  });
  const cycle = h.clock.fire();
  await Promise.resolve();

  // L'utilisateur enregistre : le cycle en cours porte sur un état dépassé.
  h.live.invalidate();
  release();

  assert.equal(await cycle, 'superseded');
  assert.equal(h.applied.length, 0);
  assert.deepEqual(h.notices, [], 'aucun avis « données modifiées » après sa propre écriture');
});

test('un avis affiché disparaît dès que la mutation locale est rendue', async () => {
  const h = harness();
  h.live.adopt('i1:r1');
  h.live.start();
  h.setBusy(true);

  h.server.mutate('r2', { clients: [{ id: 'externe' }] });
  assert.equal(await h.clock.fire(), 'deferred');
  assert.deepEqual(h.notices, [{ revision: 'i1:r2' }]);

  // L'utilisateur enregistre : `refresh()` lit la révision puis les données,
  // `render()` adopte. L'avis n'a plus lieu d'être.
  h.live.invalidate();
  h.server.mutate('r3', { clients: [{ id: 'externe' }, { id: 'local' }] });
  const key = await h.live.readKey();
  h.live.adopt(key);
  assert.deepEqual(h.notices.at(-1), null);

  assert.equal(await h.clock.fire(), 'unchanged');
  assert.equal(h.notices.length, 2, 'pas de nouvel avis pour sa propre écriture');
});

test('adopt après un chargement local évite un rechargement inutile', async () => {
  const h = harness();
  h.live.start();

  // Séquence de `refresh()` : révision lue d'abord, données ensuite.
  const key = await h.live.readKey();
  assert.equal(key, 'i1:r1');
  h.live.adopt(key);

  assert.equal(await h.clock.fire(), 'unchanged');
  assert.equal(h.server.stateCalls, 0);
});

test('readKey signale la panne sans lever', async () => {
  const h = harness();
  h.server.metaFails = 1;
  assert.equal(await h.live.readKey(), null);
  assert.deepEqual(h.statuses, [{ online: false, failures: 1 }]);
  assert.equal(await h.live.readKey(), 'i1:r1');
  assert.deepEqual(h.statuses.at(-1), { online: true, failures: 0 });
});

test('stop arrête définitivement le sondage', async () => {
  const h = harness();
  h.live.start();
  h.live.stop();
  assert.equal(h.clock.armed, 0);
  assert.equal(await h.live.wake(), 'idle');
  assert.equal(h.server.metaCalls, 0);
});
