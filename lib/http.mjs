// Utilitaires HTTP : lecture de corps bornée, réponses, statiques, garde-fous.

import fs from 'node:fs/promises';
import path from 'node:path';

import { HttpError } from './validate.mjs';

export const MAX_BODY_BYTES = 2_000_000; // 2 Mo pour les requêtes courantes
export const MAX_IMPORT_BYTES = 25_000_000; // 25 Mo : couvre un export canonique de 20 Mo max
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', extra = {}) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  });
  res.end(body);
}

export function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.message : 'Erreur interne du serveur.';
  // Les erreurs fournisseur (HttpError 5xx) ne contiennent que notre texte : pas de pile, pas de corps distant.
  if (status >= 500) console.error('[erreur]', err instanceof HttpError ? err.message : err);
  sendJson(res, status, { error: message, field: err.field ?? null });
}

function hostnameOf(value) {
  if (!value) return null;
  // Gère "127.0.0.1:4310" et "[::1]:4310".
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(value.trim());
  return match ? match[1] : null;
}

/** Le serveur n'écoute que sur la loopback : on refuse tout Host exotique (rebinding DNS). */
export function checkHost(req) {
  const hostname = hostnameOf(req.headers.host);
  if (!hostname || !ALLOWED_HOSTNAMES.has(hostname)) {
    throw new HttpError(403, 'Hôte non autorisé : cet outil n\'accepte que 127.0.0.1 ou localhost.');
  }
}

/**
 * Protection des écritures contre un site tiers : si Origin est présent il doit
 * valoir exactement `http://` + Host (même hôte, même port ; « null » refusé),
 * Sec-Fetch-Site doit rester same-origin, et le corps doit être du JSON.
 * Une requête sans Origin (curl, scripts locaux) reste acceptée.
 */
export function checkWriteRequest(req) {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const expected = `http://${(req.headers.host ?? '').trim()}`;
    if (typeof origin !== 'string' || origin.trim() === '' || origin === 'null' || origin !== expected) {
      throw new HttpError(403, 'Origine non autorisée pour une écriture : seule la page servie par cet outil peut modifier les données.');
    }
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new HttpError(403, 'Écriture refusée : requête provenant d\'un autre site.');
  }
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type && type !== 'application/json') {
    throw new HttpError(415, 'Content-Type attendu : application/json.');
  }
}

export async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const limitLabel = `Corps de requête trop volumineux (max ${maxBytes / 1_000_000} Mo).`;
  const declared = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, limitLabel);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new HttpError(413, limitLabel);
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'JSON invalide dans le corps de la requête.');
  }
}

/** Sert public/ en bloquant toute sortie du répertoire (traversée de chemin). */
export async function serveStatic(res, publicDir, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  if (decoded.includes('\0')) throw new HttpError(400, 'Chemin invalide.');
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = path.resolve(publicDir, relative);
  const root = path.resolve(publicDir);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new HttpError(403, 'Accès refusé.');
  }
  let data;
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) throw new HttpError(404, 'Ressource introuvable.');
    data = await fs.readFile(target);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(404, 'Ressource introuvable.');
  }
  const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(data);
}
