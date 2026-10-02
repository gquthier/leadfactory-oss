/**
 * Mappers de payloads webhook → lead LeadFactory.
 *
 * 3 stratégies par ordre de préférence :
 *   1. Cal.com : détecté via header `Cal-Signature-256` ou body `triggerEvent`
 *   2. Typeform : détecté via header `Typeform-Signature` ou body `event_type`
 *   3. Generic : flat-map du JSON avec un dictionnaire de clés alias
 */

export type LeadSource =
  | "meta_ads"
  | "calcom"
  | "typeform"
  | "zapier"
  | "n8n"
  | "make"
  | "webhook"
  | "other";

export interface MappedLead {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: LeadSource;
  external_id: string | null;
  /** Payload original (pour debug / audit) */
  field_data: Record<string, unknown>;
}

export interface DetectionContext {
  headers: Record<string, string>;
  body: unknown;
}

// ── Détection du provider ────────────────────────────────────────────────────

export function detectProvider(ctx: DetectionContext): LeadSource | null {
  const h = ctx.headers;
  const b = ctx.body as Record<string, unknown> | undefined;

  // Cal.com : signature header OU triggerEvent dans le body
  if (h["cal-signature-256"] || (b && typeof b.triggerEvent === "string")) {
    return "calcom";
  }

  // Typeform : signature header OU event_type='form_response'
  if (
    h["typeform-signature"] ||
    (b && typeof b.event_type === "string" && (b.event_type as string) === "form_response")
  ) {
    return "typeform";
  }

  // Zapier/n8n/Make : pas de header standardisé, mais on accepte un hint en query
  // (le client peut ajouter ?provider=zapier à son URL webhook s'il veut)
  return null;
}

// ── Mappers spécifiques ──────────────────────────────────────────────────────

export function mapCalcom(payload: unknown): MappedLead {
  const p = (payload as Record<string, unknown>) ?? {};
  const data = (p.payload as Record<string, unknown>) ?? {};
  const attendees = (data.attendees as Array<Record<string, unknown>>) ?? [];
  const first = attendees[0] ?? {};
  const responses = (data.responses as Record<string, unknown>) ?? {};

  const respValue = (key: string): string | null => {
    const r = responses[key] as Record<string, unknown> | undefined;
    if (!r) return null;
    return typeof r.value === "string" ? r.value : null;
  };

  return {
    full_name: typeof first.name === "string" ? (first.name as string) : null,
    email: typeof first.email === "string" ? (first.email as string) : null,
    phone: respValue("phone") || respValue("phoneNumber"),
    company: respValue("company") || respValue("companyName"),
    source: "calcom",
    external_id: typeof data.uid === "string" ? (data.uid as string) : null,
    field_data: data,
  };
}

export function mapTypeform(payload: unknown): MappedLead {
  const p = (payload as Record<string, unknown>) ?? {};
  const fr = (p.form_response as Record<string, unknown>) ?? {};
  const answers = (fr.answers as Array<Record<string, unknown>>) ?? [];

  // Indexer les réponses par type ou ref
  let email: string | null = null;
  let phone: string | null = null;
  let fullName: string | null = null;
  let company: string | null = null;

  for (const ans of answers) {
    const type = ans.type as string | undefined;
    const field = ans.field as Record<string, unknown> | undefined;
    const ref = field?.ref as string | undefined;

    if (type === "email" && typeof ans.email === "string" && !email) {
      email = ans.email as string;
    } else if (type === "phone_number" && typeof ans.phone_number === "string" && !phone) {
      phone = ans.phone_number as string;
    } else if (type === "short_text" || type === "long_text") {
      const text = ans.text as string | undefined;
      if (!text) continue;
      const refLower = (ref || "").toLowerCase();
      if (!fullName && (refLower.includes("name") || refLower.includes("nom"))) {
        fullName = text;
      } else if (!company && (refLower.includes("company") || refLower.includes("entreprise") || refLower.includes("societe"))) {
        company = text;
      }
    }
  }

  return {
    full_name: fullName,
    email,
    phone,
    company,
    source: "typeform",
    external_id: typeof p.event_id === "string" ? (p.event_id as string) : null,
    field_data: fr,
  };
}

// ── Mapper générique : dictionnaire de clés alias ────────────────────────────

const KEY_ALIASES: Record<keyof MappedLead, string[]> = {
  full_name: [
    "full_name", "fullName", "fullname", "name", "nom",
    "full name", "client_name", "lead_name",
  ],
  email: ["email", "e_mail", "e-mail", "mail", "emailAddress", "email_address", "courriel"],
  phone: [
    "phone", "phone_number", "phoneNumber", "telephone", "tel", "mobile",
    "phone number", "numero", "numéro", "numero_de_telephone",
  ],
  company: [
    "company", "company_name", "companyName", "organization", "organisation",
    "entreprise", "société", "societe", "org",
  ],
  source: [], // not extracted from payload
  external_id: ["id", "lead_id", "leadId", "external_id", "externalId", "uid", "uuid"],
  field_data: [],
};

/**
 * Aplatit récursivement un objet en notation point.
 * `{a: {b: 1}}` → `{"a.b": 1}`
 */
function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix) out[prefix] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function findFirstString(flat: Record<string, unknown>, aliases: string[]): string | null {
  const lowered: Array<[string, unknown]> = Object.entries(flat).map(([k, v]) => [k.toLowerCase(), v]);
  for (const alias of aliases) {
    const target = alias.toLowerCase();
    for (const [k, v] of lowered) {
      if (k === target || k.endsWith(`.${target}`)) {
        if (typeof v === "string" && v.trim().length > 0) return v.trim();
        if (typeof v === "number") return String(v);
      }
    }
  }
  return null;
}

export function mapGeneric(payload: unknown, hintProvider?: LeadSource): MappedLead {
  const p = (payload as Record<string, unknown>) ?? {};
  const flat = flatten(p);

  // Combine first_name + last_name si full_name absent
  let fullName = findFirstString(flat, KEY_ALIASES.full_name);
  if (!fullName) {
    const first = findFirstString(flat, ["first_name", "firstname", "prenom", "given_name"]);
    const last = findFirstString(flat, ["last_name", "lastname", "nom", "family_name"]);
    if (first || last) {
      fullName = [first, last].filter(Boolean).join(" ").trim() || null;
    }
  }

  return {
    full_name: fullName,
    email: findFirstString(flat, KEY_ALIASES.email),
    phone: findFirstString(flat, KEY_ALIASES.phone),
    company: findFirstString(flat, KEY_ALIASES.company),
    source: hintProvider || "webhook",
    external_id: findFirstString(flat, KEY_ALIASES.external_id),
    field_data: p,
  };
}

// ── Entry point : auto-détection + dispatch ──────────────────────────────────

export function mapPayload(ctx: DetectionContext, providerOverride?: LeadSource): MappedLead {
  const detected = providerOverride ?? detectProvider(ctx);

  if (detected === "calcom") return mapCalcom(ctx.body);
  if (detected === "typeform") return mapTypeform(ctx.body);

  return mapGeneric(ctx.body, detected ?? undefined);
}

/**
 * Email regex basique pour validation soft.
 */
export function isValidEmail(s: string | null): boolean {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
