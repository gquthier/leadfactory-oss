// Client OpenRouter minimal. Transport injectable (fetchImpl) pour les tests :
// aucun appel réseau n'est effectué sans action explicite de l'utilisateur.
// Références : https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key
//              https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion

import { HttpError } from './validate.mjs';

export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const MAX_TOKENS = 2000;
export const KEY_TIMEOUT_MS = 15_000;
export const CHAT_TIMEOUT_MS = 90_000;

const APP_HEADERS = {
  'HTTP-Referer': 'http://127.0.0.1',
  'X-Title': 'LeadFactory OSS (local)'
};

/** Messages d'erreur sûrs : statut HTTP seulement, jamais le corps du fournisseur. */
function describeStatus(status, model) {
  switch (status) {
    case 400:
      return `Requête refusée par OpenRouter (400)${model ? ` : vérifiez le nom du modèle « ${model} »` : ''}.`;
    case 401:
      return 'Clé refusée par OpenRouter (401) : vérifiez-la dans Start Here.';
    case 402:
      return 'Crédit insuffisant sur le compte OpenRouter (402).';
    case 403:
      return 'Accès refusé par OpenRouter (403) : la clé n\'a pas les droits requis.';
    case 404:
      return `Modèle introuvable sur OpenRouter (404)${model ? ` : « ${model} »` : ''}. Vérifiez l'identifiant exact.`;
    case 408:
      return 'Le fournisseur a expiré la requête (408).';
    case 429:
      return 'Trop de requêtes ou quota atteint chez OpenRouter (429). Réessayez plus tard.';
    default:
      if (status >= 500) return `OpenRouter indisponible (${status}). Réessayez plus tard.`;
      return `Réponse inattendue d'OpenRouter (${status}).`;
  }
}

async function call(fetchImpl, url, init, timeoutMs, consume = async (res) => res) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HttpError(504, `Délai dépassé (${Math.round(timeoutMs / 1000)} s) : réponse OpenRouter incomplète.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => consume(await fetchImpl(url, { ...init, signal: controller.signal })))(),
      timeout
    ]);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err?.name === 'AbortError') throw new HttpError(504, 'Délai dépassé : réponse OpenRouter incomplète.');
    throw new HttpError(502, 'Impossible de joindre OpenRouter (réseau). Aucun livrable enregistré.');
  } finally {
    clearTimeout(timer);
  }
}

/** GET /key : retourne uniquement un statut sûr. */
export async function testApiKey({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = KEY_TIMEOUT_MS }) {
  if (!apiKey) throw new HttpError(400, 'Aucune clé enregistrée.');
  const res = await call(
    fetchImpl,
    OPENROUTER_KEY_URL,
    { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, ...APP_HEADERS } },
    timeoutMs
  );
  if (!res.ok) throw new HttpError(res.status === 401 ? 401 : 502, describeStatus(res.status));
  // On ne conserve rien du corps (label, limites, usage) : seul le succès compte.
  return { ok: true };
}

/** POST /chat/completions sans retry : une seule requête facturable par clic. */
export async function chatCompletion({
  apiKey,
  model,
  messages,
  maxTokens = MAX_TOKENS,
  fetchImpl = globalThis.fetch,
  timeoutMs = CHAT_TIMEOUT_MS
}) {
  if (!apiKey) throw new HttpError(400, 'Aucune clé OpenRouter enregistrée : configurez-la dans Start Here.');
  if (!model) throw new HttpError(400, 'Aucun modèle choisi : indiquez l\'identifiant exact du modèle dans Start Here.', 'model');
  const data = await call(
    fetchImpl,
    OPENROUTER_CHAT_URL,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...APP_HEADERS },
      body: JSON.stringify({ model, messages, max_tokens: Math.min(maxTokens, MAX_TOKENS), stream: false })
    },
    timeoutMs,
    async (res) => {
      if (!res.ok) {
        const status = [401, 402, 429].includes(res.status) ? res.status : 502;
        throw new HttpError(status, describeStatus(res.status, model));
      }
      try {
        return await res.json();
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        throw new HttpError(502, 'Réponse OpenRouter illisible (JSON attendu).');
      }
    }
  );
  // Certaines erreurs arrivent en 200 avec un objet `error` : ne pas les prendre pour un succès.
  if (data && typeof data === 'object' && data.error) {
    throw new HttpError(502, describeStatus(Number(data.error.code) || 502, model));
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new HttpError(502, 'OpenRouter n\'a renvoyé aucun texte exploitable : aucun livrable créé.');
  }
  return {
    content: content.trim(),
    model: typeof data.model === 'string' && data.model ? data.model : model,
    finishReason: data.choices[0].finish_reason ?? null,
    usage: data.usage && typeof data.usage === 'object' ? {
      promptTokens: Number(data.usage.prompt_tokens) || 0,
      completionTokens: Number(data.usage.completion_tokens) || 0
    } : null
  };
}
