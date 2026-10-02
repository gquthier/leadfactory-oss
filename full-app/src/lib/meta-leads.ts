/**
 * Meta Lead Ads API — Lead Factory
 * Flow : User token → /me/accounts (page tokens) → /{page_id}/leadgen_forms → /{form_id}/leads
 *
 * IMPORTANT: /{ad_account_id}/leadgen_forms est déprécié par Meta.
 *            Il faut passer par le Page Access Token de la Page Facebook.
 */

const META_API_BASE = "https://graph.facebook.com/v21.0";
function getUserToken() { return process.env.META_ACCESS_TOKEN ?? ""; }

export interface MetaLeadForm {
  id: string;
  name: string;
  status: string;
  created_time: string;
}

export interface MetaLeadFieldData {
  name: string;
  values: string[];
}

export interface MetaLeadRaw {
  id: string;
  created_time: string;
  ad_id: string | null;
  form_id: string;
  field_data: MetaLeadFieldData[];
}

export interface ParsedLead {
  meta_lead_id: string;
  meta_form_id: string;
  meta_ad_id: string | null;
  meta_created_at: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  field_data: Record<string, unknown>;
}

/** Fetch générique avec un token explicite */
async function metaFetch(path: string, params: Record<string, string> = {}, token?: string): Promise<unknown> {
  const url = new URL(`${META_API_BASE}${path}`);
  url.searchParams.set("access_token", token ?? getUserToken());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta API error: ${JSON.stringify(err)}`);
  }
  return res.json();
}

/**
 * Retourne le Page Access Token d'une page depuis /me/accounts.
 * Nécessaire car /{page_id}/leadgen_forms requiert un Page Access Token.
 * @param userToken token utilisateur Meta (optionnel, fallback sur env)
 */
export async function getPageToken(pageId: string, userToken?: string): Promise<string> {
  const data = await metaFetch("/me/accounts", {
    fields: "id,access_token",
    limit: "100",
  }, userToken) as { data: Array<{ id: string; access_token: string }> };

  const page = (data.data ?? []).find(p => p.id === pageId);
  if (!page?.access_token) {
    throw new Error(
      `Page ${pageId} non trouvée dans /me/accounts. ` +
      `Assurez-vous que le token a accès à cette Page Facebook.`
    );
  }
  return page.access_token;
}

/**
 * Trouve le page_id Facebook associé à un compte publicitaire
 * via les adsets (promoted_object.page_id).
 * @param userToken token utilisateur Meta (optionnel, fallback sur env)
 */
export async function getPageIdForAdAccount(adAccountId: string, userToken?: string): Promise<string | null> {
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const data = await metaFetch(`/${accountId}/adsets`, {
    fields: "promoted_object",
    limit: "50",
  }, userToken) as { data: Array<{ promoted_object?: { page_id?: string } }> };

  for (const adset of (data.data ?? [])) {
    const pageId = adset.promoted_object?.page_id;
    if (pageId) return pageId;
  }
  return null;
}

/**
 * Retourne les formulaires Lead Ads d'une Page Facebook.
 * @param userToken token utilisateur Meta (optionnel, fallback sur env)
 */
export async function getLeadFormsForPage(pageId: string, userToken?: string): Promise<MetaLeadForm[]> {
  const pageToken = await getPageToken(pageId, userToken);
  const data = await metaFetch(`/${pageId}/leadgen_forms`, {
    fields: "id,name,status,created_time",
    limit: "100",
  }, pageToken) as { data: Array<Record<string, unknown>> };

  return (data.data ?? []).map((f) => ({
    id: String(f.id),
    name: String(f.name ?? ""),
    status: String(f.status ?? ""),
    created_time: String(f.created_time ?? ""),
  }));
}

/**
 * Retourne les formulaires Lead Ads d'un compte publicitaire.
 * Découvre automatiquement la Page Facebook associée via les adsets.
 * @param userToken token utilisateur Meta (optionnel, fallback sur env)
 */
export async function getLeadForms(adAccountId: string, userToken?: string): Promise<MetaLeadForm[]> {
  const pageId = await getPageIdForAdAccount(adAccountId, userToken);
  if (!pageId) {
    throw new Error(
      `Impossible de trouver la Page Facebook pour le compte ${adAccountId}. ` +
      `Assurez-vous que le compte a des adsets actifs.`
    );
  }
  return getLeadFormsForPage(pageId, userToken);
}

/**
 * Retourne les leads d'un formulaire avec pagination par curseur.
 * pageToken : Page Access Token (obligatoire pour lire les leads).
 */
export async function getFormLeads(
  formId: string,
  pageToken: string,
  after?: string
): Promise<{ leads: MetaLeadRaw[]; nextCursor: string | null }> {
  const params: Record<string, string> = {
    fields: "id,created_time,ad_id,form_id,field_data",
    limit: "200",
  };
  if (after) params.after = after;

  const data = await metaFetch(`/${formId}/leads`, params, pageToken) as {
    data: Array<Record<string, unknown>>;
    paging?: { cursors?: { after?: string }; next?: string };
  };

  const leads: MetaLeadRaw[] = (data.data ?? []).map((row) => ({
    id: String(row.id),
    created_time: String(row.created_time ?? ""),
    ad_id: row.ad_id ? String(row.ad_id) : null,
    form_id: String(row.form_id ?? formId),
    field_data: (row.field_data as MetaLeadFieldData[]) ?? [],
  }));

  const nextCursor = data.paging?.next ? (data.paging.cursors?.after ?? null) : null;

  return { leads, nextCursor };
}

/**
 * Récupère UN lead via son leadgen_id — chemin temps réel du webhook leadgen.
 * pageToken : Page Access Token de la Page qui possède le formulaire (obligatoire).
 */
export async function getSingleLead(leadgenId: string, pageToken: string): Promise<MetaLeadRaw> {
  const row = (await metaFetch(
    `/${leadgenId}`,
    { fields: "id,created_time,ad_id,form_id,field_data" },
    pageToken
  )) as Record<string, unknown>;

  return {
    id: String(row.id),
    created_time: String(row.created_time ?? ""),
    ad_id: row.ad_id ? String(row.ad_id) : null,
    form_id: String(row.form_id ?? ""),
    field_data: (row.field_data as MetaLeadFieldData[]) ?? [],
  };
}

/**
 * Extrait les champs contact depuis field_data Meta.
 * Gère les noms de champs en français et en anglais.
 */
export function parseLeadFields(fieldData: MetaLeadFieldData[]): {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
} {
  const get = (names: string[]): string | null => {
    for (const name of names) {
      const field = fieldData.find(
        (f) => f.name.toLowerCase() === name.toLowerCase()
      );
      if (field?.values?.[0]) return field.values[0];
    }
    return null;
  };

  // Concatène first_name + last_name quand full_name est absent
  let full_name = get(["full_name", "name", "nom_complet"]);
  if (!full_name) {
    const firstName = get(["first_name", "prénom", "firstname"]);
    const lastName = get(["last_name", "nom", "lastname", "surname"]);
    if (firstName || lastName) {
      full_name = [firstName, lastName].filter(Boolean).join(" ");
    }
  }

  return {
    full_name,
    email: get(["email", "email_address", "e-mail", "courriel"]),
    phone: get([
      "phone_number", "phone", "tel", "téléphone", "mobile",
      "numéro_de_téléphone", "numero_de_telephone", "phone_number_0",
    ]),
    company: get([
      "company_name", "company", "entreprise", "société", "organization",
      "job_company_name", "nom_entreprise",
    ]),
  };
}

/**
 * Récupère TOUS les leads d'un formulaire (pagination complète).
 * pageToken : Page Access Token de la page qui possède le formulaire.
 */
export async function getAllFormLeads(formId: string, pageToken: string): Promise<ParsedLead[]> {
  const allLeads: ParsedLead[] = [];
  let cursor: string | undefined = undefined;

  for (let page = 0; page < 20; page++) {
    const { leads, nextCursor } = await getFormLeads(formId, pageToken, cursor);

    for (const raw of leads) {
      const parsed = parseLeadFields(raw.field_data);
      const fieldMap: Record<string, unknown> = {};
      for (const f of raw.field_data) {
        fieldMap[f.name] = f.values?.[0] ?? null;
      }
      allLeads.push({
        meta_lead_id: raw.id,
        meta_form_id: raw.form_id,
        meta_ad_id: raw.ad_id,
        meta_created_at: raw.created_time,
        ...parsed,
        field_data: fieldMap,
      });
    }

    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return allLeads;
}
