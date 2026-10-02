/**
 * Meta (Facebook) OAuth + Lead Ads webhook plumbing — LeadFactory.
 *
 * Calque sur lib/linkedin/oauth.ts. Couvre :
 *  - OAuth client "Connecter Facebook" (Facebook Login for Business) : voie B.
 *  - Derivation des Page Access Tokens (longue duree) : voie A & B.
 *  - Abonnement d'une Page au champ `leadgen` (POST /{page_id}/subscribed_apps).
 *  - Config du webhook au niveau app (POST /{app_id}/subscriptions) — scriptable
 *    avec un app access token, sans passer par le dashboard.
 *
 * Les secrets (FB_APP_ID / FB_APP_SECRET / META_REDIRECT_URI) sont lus au runtime
 * via requireEnv — ce module se construit/compile sans qu'ils soient definis.
 */

export const META_SCOPES = [
  "leads_retrieval",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "ads_read",
  "ads_management",
  "business_management",
];

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const FB_DIALOG = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export interface MetaShortToken {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}
export interface MetaLongToken {
  access_token: string;
  token_type?: string;
  expires_in?: number; // ~60 jours
}
export interface MetaPage {
  id: string;
  name: string;
  access_token: string; // Page Access Token (non-expirant si derive d'un long-lived user token)
  instagram_business_account?: { id: string } | null;
  tasks?: string[];
}

/**
 * URL du dialogue OAuth. Si META_LOGIN_CONFIG_ID est defini (config "Facebook
 * Login for Business"), on l'utilise (flow recommande). Sinon fallback scope-based.
 */
export function buildAuthUrl(state: string): string {
  const configId = process.env.META_LOGIN_CONFIG_ID;
  const params = new URLSearchParams({
    client_id: requireEnv("FB_APP_ID"),
    redirect_uri: requireEnv("META_REDIRECT_URI"),
    state,
    response_type: "code",
  });
  if (configId) {
    params.set("config_id", configId);
  } else {
    params.set("scope", META_SCOPES.join(","));
  }
  return `${FB_DIALOG}?${params.toString()}`;
}

async function graphGet<T>(path: string, params: Record<string, string>, token?: string): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  if (token) url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Meta GET ${path} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function graphPost<T>(path: string, body: Record<string, string>, token?: string): Promise<T> {
  const form = new URLSearchParams(body);
  if (token) form.set("access_token", token);
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Meta POST ${path} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** code -> short-lived user token */
export async function exchangeCodeForToken(code: string): Promise<MetaShortToken> {
  return graphGet<MetaShortToken>("/oauth/access_token", {
    client_id: requireEnv("FB_APP_ID"),
    redirect_uri: requireEnv("META_REDIRECT_URI"),
    client_secret: requireEnv("FB_APP_SECRET"),
    code,
  });
}

/** short-lived -> long-lived (~60j) user token. Indispensable pour des page tokens stables. */
export async function exchangeForLongLivedToken(shortToken: string): Promise<MetaLongToken> {
  return graphGet<MetaLongToken>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: requireEnv("FB_APP_ID"),
    client_secret: requireEnv("FB_APP_SECRET"),
    fb_exchange_token: shortToken,
  });
}

/** /me -> { id } (pour meta_user_id) */
export async function getMeId(userToken: string): Promise<string | null> {
  try {
    const me = await graphGet<{ id: string }>("/me", { fields: "id" }, userToken);
    return me.id ?? null;
  } catch {
    return null;
  }
}

/** Pages + Page Access Tokens depuis /me/accounts */
export async function getPagesWithTokens(userToken: string): Promise<MetaPage[]> {
  const data = await graphGet<{ data: MetaPage[] }>(
    "/me/accounts",
    { fields: "id,name,access_token,instagram_business_account,tasks", limit: "200" },
    userToken
  );
  return data.data ?? [];
}

/** Abonne la Page au champ leadgen pour CETTE app. Auth = Page Access Token. */
export async function subscribePageToLeadgen(pageId: string, pageToken: string): Promise<boolean> {
  const r = await graphPost<{ success?: boolean }>(
    `/${pageId}/subscribed_apps`,
    { subscribed_fields: "leadgen" },
    pageToken
  );
  return r.success === true;
}

/** Desabonne la Page (disconnect). Auth = Page Access Token. */
export async function unsubscribePageFromLeadgen(pageId: string, pageToken: string): Promise<boolean> {
  const form = new URLSearchParams({ access_token: pageToken });
  const res = await fetch(`${GRAPH}/${pageId}/subscribed_apps?${form.toString()}`, { method: "DELETE" });
  return res.ok;
}

/** App access token = {app_id}|{app_secret} (jamais expose cote client). */
export function appAccessToken(): string {
  return `${requireEnv("FB_APP_ID")}|${requireEnv("FB_APP_SECRET")}`;
}

/**
 * Configure le webhook au niveau de l'app (objet `page`, champ `leadgen`) via l'API
 * — alternative scriptable au dashboard. Necessite l'app access token.
 */
export async function subscribeAppWebhook(callbackUrl: string, verifyToken: string): Promise<boolean> {
  const r = await graphPost<{ success?: boolean }>(
    `/${requireEnv("FB_APP_ID")}/subscriptions`,
    {
      object: "page",
      callback_url: callbackUrl,
      fields: "leadgen",
      verify_token: verifyToken,
      include_values: "true",
    },
    appAccessToken()
  );
  return r.success === true;
}
