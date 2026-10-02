/**
 * Forward best-effort d'un lead vers le bridge GoHighLevel (service Railway).
 *
 * Activé UNIQUEMENT si les env sont présentes :
 *   GHL_BRIDGE_URL        URL du endpoint bridge (…/webhook/leads)
 *   GHL_BRIDGE_SECRET     secret partagé (header x-bridge-secret)
 *   GHL_BRIDGE_CLIENT_IDS allow-list de client_id (CSV) — seuls ces clients sont forwardés
 *
 * Sans ces env (ou client hors allow-list) → no-op total : aucun changement de
 * comportement pour les autres clients. Ne throw JAMAIS (best-effort, comme l'email).
 *
 * Le bridge gère : upsert Contact + création Opportunité si absente (dédup avec
 * l'intégration FB native de GHL). Source : ~/brainOS/Projects/LeadFactory/azureo-ghl-bridge.
 */

export interface GhlBridgeLead {
  clientId: string;
  leadId: string;
  contact: { full_name: string | null; email: string | null; phone: string | null; company: string | null };
  source: string;
  columns?: Record<string, unknown>;
}

export async function maybeForwardLeadToGhlBridge(lead: GhlBridgeLead): Promise<void> {
  try {
    const url = process.env.GHL_BRIDGE_URL;
    const secret = process.env.GHL_BRIDGE_SECRET;
    if (!url || !secret) return;

    const allow = (process.env.GHL_BRIDGE_CLIENT_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allow.length === 0 || !allow.includes(lead.clientId)) return; // hors périmètre → no-op

    const cols = lead.columns ?? {};
    const record = {
      client_id: lead.clientId,
      id: lead.leadId,
      full_name: lead.contact.full_name,
      email: lead.contact.email,
      phone: lead.contact.phone,
      company: lead.contact.company,
      source: lead.source,
      field_data: cols.field_data ?? null,
      meta_lead_id: cols.meta_lead_id ?? cols.external_id ?? null,
      meta_form_id: cols.meta_form_id ?? null,
      meta_form_name: cols.meta_form_name ?? null,
      meta_created_at: cols.meta_created_at ?? null,
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bridge-secret": secret },
        body: JSON.stringify({ record }),
        signal: ctrl.signal,
      });
      if (!res.ok) console.error("[ghl-bridge] forward non-200:", res.status);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("[ghl-bridge] forward failed (non-blocking):", e instanceof Error ? e.message : e);
  }
}
