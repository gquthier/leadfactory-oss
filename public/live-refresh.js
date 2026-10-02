// Rafraîchissement de la page ouverte quand les données changent ailleurs
// (agent BizOS local, second onglet, appel HTTP direct).
//
// Module pur : toutes les dépendances (réseau, minuterie, DOM) sont injectées,
// il est donc testable sans navigateur. Règles tenues ici :
//   - une seule requête en vol à la fois, jamais de requêtes empilées ;
//   - la révision n'est considérée « appliquée » qu'après le rendu réussi ;
//   - si l'utilisateur est en train de saisir, on n'écrase rien : on signale ;
//   - une coupure réseau produit un indicateur d'état, pas un message répété.

export const DEFAULT_INTERVAL = 3000;
export const DEFAULT_MAX_BACKOFF = 30000;

const NON_TEXT_INPUTS = ['search', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file'];

function valueOf(node) {
  return node.type === 'checkbox' || node.type === 'radio' ? String(node.checked) : String(node.value ?? '');
}

/**
 * Vrai si le curseur est dans un champ de saisie libre. Un champ de recherche
 * est exclu : il est piloté par l'état de l'application et survit au rendu.
 */
export function isTypingIn(node) {
  if (!node) return false;
  if (node.isContentEditable) return true;
  if (node.tagName === 'TEXTAREA') return true;
  if (node.tagName !== 'INPUT') return false;
  return !NON_TEXT_INPUTS.includes(node.type);
}

/**
 * Détection de brouillon non enregistré, indépendante de l'application : on
 * mémorise la valeur de chaque champ au moment du rendu, puis on compare.
 * Couvre aussi bien les formulaires en ligne que ceux d'une fenêtre modale.
 */
export function createInputGuard() {
  const baseline = new WeakMap();
  const fields = (root) => (root && root.querySelectorAll ? root.querySelectorAll('input, textarea, select') : []);
  return {
    capture(root) {
      for (const node of fields(root)) baseline.set(node, valueOf(node));
    },
    isDirty(root) {
      for (const node of fields(root)) {
        const before = baseline.get(node);
        if (before !== undefined && before !== valueOf(node)) return true;
      }
      return false;
    }
  };
}

/** Clé de comparaison : une nouvelle instance de serveur invalide la révision. */
export function metaKey(meta) {
  if (meta === null || typeof meta !== 'object') return null;
  if (typeof meta.revision !== 'string' || meta.revision === '') return null;
  const instance = typeof meta.instanceId === 'string' ? meta.instanceId : '';
  return `${instance}:${meta.revision}`;
}

/**
 * @param readMeta    () => Promise<{ revision, instanceId }>  (GET /api/meta)
 * @param readState   () => Promise<données>                   (GET /api/state)
 * @param applyState  (données) => Promise<void> — doit rendre l'écran
 * @param isBusy      () => bool — vrai si une saisie serait écrasée
 * @param onNotice    (avis|null) => void — avis discret « données modifiées »
 * @param onStatus    ({ online, failures }) => void — sur transition seulement
 */
export function createLiveRefresh({
  readMeta,
  readState,
  applyState,
  isBusy = () => false,
  onNotice = () => {},
  onStatus = () => {},
  interval = DEFAULT_INTERVAL,
  maxBackoff = DEFAULT_MAX_BACKOFF,
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (id) => globalThis.clearTimeout(id)
} = {}) {
  let running = false;
  let visible = true;
  let timer = null;
  let inFlight = false;
  let appliedKey = null;
  let pendingKey = null;
  let failures = 0;
  let online = true;
  // Incrémenté à chaque écriture locale : un cycle démarré avant la mutation
  // ne doit ni appliquer ses données périmées ni afficher un faux avis.
  let seq = 0;
  // Rechargement explicite réclamé alors qu'un cycle était déjà en vol.
  let forcePending = false;

  function setOnline(next) {
    if (online === next) return;
    online = next;
    onStatus({ online, failures });
  }

  function setNotice(key) {
    if (pendingKey === key) return;
    pendingKey = key;
    onNotice(key === null ? null : { revision: key });
  }

  function nextDelay() {
    if (failures === 0) return interval;
    // Recul progressif : une coupure ne provoque pas une requête toutes les 3 s.
    return Math.min(interval * 2 ** Math.min(failures, 10), maxBackoff);
  }

  function disarm() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function arm() {
    disarm();
    if (!running || !visible) return;
    timer = setTimer(() => {
      timer = null;
      return cycle();
    }, nextDelay());
  }

  /**
   * Un cycle : lire la révision, et seulement si elle a changé, recharger.
   * `force` (action explicite de l'utilisateur) ignore la saisie en cours et
   * la visibilité de la page.
   */
  /**
   * Enchaîne les cycles sans jamais en superposer deux. Un rechargement demandé
   * explicitement pendant un cycle en vol n'est pas perdu : il est rejoué juste
   * après, sinon le clic de l'utilisateur resterait sans effet.
   */
  async function cycle(opts = {}) {
    const result = await runCycle(opts);
    if (forcePending && !inFlight) {
      forcePending = false;
      return cycle({ force: true });
    }
    return result;
  }

  async function runCycle({ force = false } = {}) {
    if (inFlight) {
      if (force) forcePending = true;
      return 'inflight';
    }
    if (!force && (!running || !visible)) return 'idle';
    inFlight = true;
    const startedAt = seq;
    try {
      const key = metaKey(await readMeta());
      failures = 0;
      setOnline(true);
      if (key === null) return 'no-revision';
      if (seq !== startedAt) return 'superseded';
      if (key === appliedKey) {
        setNotice(null);
        return 'unchanged';
      }
      if (!force && isBusy()) {
        setNotice(key);
        return 'deferred';
      }
      const data = await readState();
      if (seq !== startedAt) return 'superseded';
      // La saisie a pu commencer pendant la requête : dernier contrôle.
      if (!force && isBusy()) {
        setNotice(key);
        return 'deferred';
      }
      try {
        await applyState(data);
      } catch {
        // Échec de rendu : la révision n'est pas adoptée, on réessaiera.
        // Ce n'est pas une panne réseau : l'indicateur de connexion ne bouge pas.
        return 'apply-failed';
      }
      // Adoptée seulement maintenant : les données sont rendues.
      appliedKey = key;
      setNotice(null);
      return 'applied';
    } catch {
      failures += 1;
      setOnline(false);
      return 'error';
    } finally {
      inFlight = false;
      arm();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      arm();
    },
    stop() {
      running = false;
      forcePending = false;
      disarm();
    },
    /** Page cachée : on suspend. Page revisible : on vérifie tout de suite. */
    setVisible(next) {
      const value = Boolean(next);
      if (visible === value) return undefined;
      visible = value;
      if (!visible) {
        disarm();
        return undefined;
      }
      return cycle();
    },
    /** Retour de focus : vérification immédiate, sans empiler de requête. */
    wake() {
      return cycle();
    },
    /** Action explicite de l'utilisateur : recharge même en pleine saisie. */
    reloadNow() {
      return cycle({ force: true });
    },
    /** À appeler avant chaque écriture locale (voir `seq`). */
    invalidate() {
      seq += 1;
    },
    /**
     * Déclare une révision comme rendue. Le lecteur doit avoir lu la révision
     * AVANT les données, pour ne jamais adopter une révision plus récente que
     * l'état affiché.
     */
    adopt(key) {
      if (typeof key !== 'string' || key === '') return;
      appliedKey = key;
      setNotice(null);
    },
    /** Lecture ponctuelle de la révision courante (avant un chargement local). */
    async readKey() {
      try {
        const key = metaKey(await readMeta());
        failures = 0;
        setOnline(true);
        return key;
      } catch {
        failures += 1;
        setOnline(false);
        return null;
      }
    },
    status() {
      return { running, visible, inFlight, online, failures, appliedKey, pendingKey };
    }
  };
}
