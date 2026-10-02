// Protection d'accès optionnelle du cockpit.
//
// En mode autonome (`npm start`) rien ne change : outil local mono-utilisateur,
// sans authentification. Quand le cockpit est embarqué dans un hôte (sidecar
// BizOS), l'hôte passe un jeton de service à `createApp({ accessToken })` et
// toutes les routes `/api/*` deviennent fermées : sans ce jeton, un agent local
// ne peut plus contourner l'hôte en parlant directement au serveur HTTP.
//
// Deux façons de prouver l'accès :
//   - `Authorization: Bearer <jeton de service>` — pour l'hôte lui-même ;
//   - un cookie de session — pour la page ouverte dans le navigateur.
//
// Le jeton de service ne circule JAMAIS dans une URL. Pour ouvrir la page,
// l'hôte demande un ticket à usage unique (`issueDashboardTicket()`) et ne le
// met dans le fragment `#connect=` qu'au clic humain sur « ouvrir ». La page
// l'échange contre un cookie via `POST /api/session`, puis efface le fragment.
//
// Rien n'est lu depuis l'environnement ni depuis un fichier : tout est en
// mémoire et disparaît avec le processus (ou avec `close()`).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { HttpError } from './validate.mjs';

/** Un jeton de service plus court n'offrirait pas assez d'entropie. */
export const MIN_ACCESS_TOKEN_LENGTH = 32;
/** Ticket d'ouverture : 32 octets = 64 caractères hexadécimaux. */
export const TICKET_TTL_MS = 60_000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Bornes de mémoire : ni ticket ni session ne peuvent s'accumuler sans fin. */
export const MAX_TICKETS = 128;
export const MAX_SESSIONS = 128;
/** Au-delà, l'en-tête est ignoré : aucune raison de comparer un jeton géant. */
const MAX_CREDENTIAL_LENGTH = 512;

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Comparaison à temps constant. Les deux valeurs sont d'abord condensées :
 * la comparaison porte donc toujours sur 32 octets et ne laisse pas non plus
 * filtrer la longueur du secret.
 */
function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/**
 * `Authorization: Bearer <valeur>`, strictement : ce schéma exact, un seul
 * espace, une valeur non vide et bornée. Tout le reste vaut « pas de jeton ».
 */
export function readBearer(header) {
  if (typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const value = header.slice(7);
  if (value === '' || value.length > MAX_CREDENTIAL_LENGTH) return null;
  if (value.includes(' ')) return null;
  return value;
}

/**
 * Lecture d'un cookie nommé, sans construire d'objet intermédiaire : aucune
 * clé attaquante ne peut atteindre un prototype. Première occurrence retenue.
 */
export function readCookie(header, name) {
  if (typeof header !== 'string' || header === '') return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (value === '' || value.length > MAX_CREDENTIAL_LENGTH) return null;
    return value;
  }
  return null;
}

/** Message unique : ni le ticket, ni le jeton, ni la cause exacte ne fuitent. */
function refused() {
  return new HttpError(
    401,
    'Accès refusé : ce cockpit est ouvert par son application hôte. Rouvrez-le depuis celle-ci pour obtenir une session.'
  );
}

/**
 * @param accessToken  jeton de service fourni par l'hôte, ou `null` (autonome).
 * @param clock        horloge injectable, en millisecondes (tests).
 */
export function createDashboardAccess({ accessToken = null, clock = Date.now } = {}) {
  if (accessToken !== null && accessToken !== undefined) {
    if (typeof accessToken !== 'string') {
      throw new TypeError('createApp({ accessToken }) attend une chaîne de caractères, ou null pour le mode autonome.');
    }
    if (accessToken.length < MIN_ACCESS_TOKEN_LENGTH) {
      throw new Error(
        `createApp({ accessToken }) exige un secret d'au moins ${MIN_ACCESS_TOKEN_LENGTH} caractères ` +
          `(reçu : ${accessToken.length}). Faites-le générer aléatoirement par l'application hôte.`
      );
    }
  }

  const enabled = typeof accessToken === 'string';
  // Les cookies ne sont pas cloisonnés par port : deux cockpits sur 127.0.0.1
  // partageraient un nom commun et s'écraseraient. Un suffixe aléatoire par
  // instance évite la collision. Ce nom n'est pas un secret.
  const cookieName = enabled ? `lf_dashboard_${randomBytes(6).toString('hex')}` : null;
  const tickets = new Map();
  const sessions = new Map();
  let closed = false;

  /** Purge opportuniste : appelée à chaque émission et à chaque échange. */
  function sweep() {
    const at = clock();
    for (const [key, expiresAt] of tickets) if (expiresAt <= at) tickets.delete(key);
    for (const [key, expiresAt] of sessions) if (expiresAt <= at) sessions.delete(key);
  }

  /** Les Map conservent l'ordre d'insertion : la plus ancienne part la première. */
  function capacity(map, max) {
    while (map.size >= max) {
      const oldest = map.keys().next();
      if (oldest.done) return;
      map.delete(oldest.value);
    }
  }

  function issueTicket() {
    if (!enabled) {
      throw new Error(
        'issueDashboardTicket() exige createApp({ accessToken }) : cette instance est en mode autonome, sans authentification.'
      );
    }
    if (closed) throw new Error('issueDashboardTicket() : cette instance du cockpit est fermée.');
    sweep();
    capacity(tickets, MAX_TICKETS);
    const ticket = randomBytes(32).toString('hex');
    tickets.set(ticket, clock() + TICKET_TTL_MS);
    return ticket;
  }

  /**
   * Échange d'un ticket contre une session. Le corps doit être exactement
   * `{ "ticket": "<64 hex>" }` : toute autre forme est refusée comme un ticket
   * invalide, sans indiquer laquelle des conditions a échoué.
   *
   * @returns la valeur de l'en-tête `Set-Cookie` à renvoyer.
   */
  function redeemTicket(body) {
    if (!enabled || closed) throw refused();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw refused();
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'ticket') throw refused();
    const ticket = body.ticket;
    if (typeof ticket !== 'string' || !HEX64.test(ticket)) throw refused();

    sweep();
    // Consommation atomique : le ticket est retiré avant toute validation, un
    // rejeu ne peut donc jamais retomber sur une entrée encore présente.
    const expiresAt = tickets.get(ticket);
    const existed = tickets.delete(ticket);
    if (!existed || typeof expiresAt !== 'number' || expiresAt <= clock()) throw refused();

    capacity(sessions, MAX_SESSIONS);
    const sessionId = randomBytes(32).toString('hex');
    sessions.set(sessionId, clock() + SESSION_TTL_MS);
    // Pas de Domain (donc pas de partage avec un autre hôte), pas de Secure
    // (la boucle locale est en clair), HttpOnly pour rester hors de portée du JS.
    return `${cookieName}=${sessionId}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Strict`;
  }

  function validSession(sessionId) {
    if (typeof sessionId !== 'string' || !HEX64.test(sessionId)) return false;
    const expiresAt = sessions.get(sessionId);
    if (typeof expiresAt !== 'number') return false;
    if (expiresAt <= clock()) {
      sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  /**
   * Autorise la requête ou lève une 401. En mode autonome, ne fait rien :
   * le comportement historique est conservé à l'identique.
   *
   * @returns 'standalone' | 'bearer' | 'session'
   */
  function authorize(req) {
    if (!enabled) return 'standalone';
    if (closed) throw refused();
    const headers = req?.headers ?? {};
    const bearer = readBearer(headers.authorization);
    if (bearer !== null && constantTimeEquals(bearer, accessToken)) return 'bearer';
    if (validSession(readCookie(headers.cookie, cookieName))) return 'session';
    throw refused();
  }

  /** Vrai pour la seule route accessible sans autorisation : POST /api/session. */
  function isTicketExchange(segments, method) {
    return enabled && method === 'POST' && segments.length === 2 && segments[0] === 'api' && segments[1] === 'session';
  }

  function close() {
    closed = true;
    tickets.clear();
    sessions.clear();
  }

  return {
    enabled,
    cookieName,
    issueTicket,
    redeemTicket,
    authorize,
    isTicketExchange,
    close,
    /** Introspection réservée aux tests : ne renvoie aucune valeur secrète. */
    sizes() {
      return { tickets: tickets.size, sessions: sessions.size, closed };
    }
  };
}
