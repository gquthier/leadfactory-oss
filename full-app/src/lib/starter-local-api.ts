import {isLocalHost,isLocalOrigin} from './starter-origin';
import { randomUUID } from "node:crypto";
import { executeLocalQuery, localTransaction, LOCAL_ADMIN_ID, rejectSecrets } from "./starter-local-store";
import type { LocalDatabase, StoreOptions } from "./starter-local-store";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const timestamp = () => new Date().toISOString();
const fields = (source: any, names: string[]) => Object.fromEntries(names.filter(name => source[name] !== undefined).map(name => [name, source[name]]));
function row(data: Record<string, any>): Record<string, any> { return { id: randomUUID(), created_at: timestamp(), updated_at: timestamp(), ...data }; }
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function safeDocument(value: unknown): string | null {
  if (!text(value)) return null;
  const url = new URL(text(value));
  requireValue(["https:", "http:"].includes(url.protocol) && !url.username && !url.password, "URL de document invalide");
  return url.toString();
}
function resourceFields(data: any) {
  const result: Record<string, any> = {};
  if (data.title !== undefined) { requireValue(text(data.title), "Titre requis"); result.title = text(data.title); }
  if (data.kind !== undefined) result.kind = data.kind === "sop" ? "sop" : "resource";
  if (data.is_published !== undefined) result.is_published = Boolean(data.is_published);
  if (data.document_url !== undefined) result.document_url = safeDocument(data.document_url);
  if (data.loom_url !== undefined) {
    result.loom_url = null;
    if (text(data.loom_url)) { const url = new URL(text(data.loom_url)); const id = url.pathname.match(/^\/(?:share|embed|v)\/([a-f0-9]{20,})$/i)?.[1]; requireValue(["www.loom.com", "loom.com"].includes(url.hostname) && id, "Lien Loom invalide"); result.loom_url = `https://www.loom.com/embed/${id}`; }
  }
  if (data.body_text !== undefined || data.body_html !== undefined) {
    // Native rich-text input is reduced to inert text; historical viewer uses innerHTML.
    const content = text(data.body_text) || text(data.body_html).replace(/<[^>]*>/g, "");
    result.body_text = content;
    result.body_html = content ? `<p>${content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\n/g, "<br>")}</p>` : null;
  }
  return result;
}
function localGuard(req: Request) {
  const url = new URL(req.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Le starter est réservé à la machine locale");
  const host=req.headers.get("host")||url.host;
  if(!isLocalHost(host))throw new Error("Hôte local requis");
  const origin = req.headers.get("origin");
  if (!isLocalOrigin(host,origin)) throw new Error("Origine refusée");
}
async function body(req: Request) {
  const source = await req.text();
  if (source.length > 200_000) throw new Error("Requête trop volumineuse");
  const data = source ? JSON.parse(source) : {};
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Objet JSON requis");
  return data;
}

/** Secret-bearing historical onboarding fields are discarded, never persisted or returned. */
export function stripCredentials(value: any): any {
  if (Array.isArray(value)) return value.map(stripCredentials);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/password|secret|(?:^|_)token(?:$|_)|api_?key|credential|authorization|__proto__|constructor|prototype/i.test(key)).map(([key, val]) => [key, stripCredentials(val)]));
}

export async function handleLocalQuery(req: Request, options: StoreOptions = {}) {
  try {
    localGuard(req);
    if (req.method !== "POST") return json({ error: "POST requis" }, 405);
    const result = await executeLocalQuery(await body(req), options);
    return json(result, result.error ? 400 : 200);
  } catch (error) { return json({ data: null, error: { message: error instanceof Error ? error.message : "Requête refusée" } }, 400); }
}

function newClient(db: LocalDatabase, data: any) {
  requireValue(text(data.full_name), "Le nom est requis");
  const email = text(data.email).toLowerCase();
  if (email && db.tables.profiles.some(profile => profile.email === email)) throw new Error("Cette adresse existe déjà localement");
  const client = row({ ...fields(data, ["phone"]), full_name: text(data.full_name), company: text(data.company) || text(data.full_name), email, role: "client", is_active: true, is_super_admin: false, managed_by: LOCAL_ADMIN_ID });
  db.tables.profiles.push(client);
  for (const title of ["Compléter le brief d'onboarding", "Partager les assets et la charte de marque", "Préparer les accès publicitaires sans partager de mot de passe"]) db.tables.client_tasks.push(row({ client_id: client.id, created_by: LOCAL_ADMIN_ID, title, description: "", is_completed: false }));
  return client;
}

function createBriefCampaign(db: LocalDatabase, onboarding: any, client: any) {
  const responses = onboarding.responses;
  const rawBudget = Number.parseFloat(String(responses.g_budget || responses.budget || ""));
  const campaign = row({ client_id: client.id, onboarding_response_id: onboarding.id, managed_by: LOCAL_ADMIN_ID, name: `Campagne Meta — ${client.company}`, status: "brief_received", platform: "meta", budget_monthly: Number.isFinite(rawBudget) && rawBudget >= 0 ? rawBudget : null, objective: Array.isArray(responses.b_objectif) ? responses.b_objectif[0] : responses.b_objectif || responses.objectif || responses.goal || "leads", weekly_report_enabled: false });
  db.tables.campaigns.push(campaign);
  onboarding.client_id = client.id; onboarding.campaign_id = campaign.id;
  return campaign;
}

/** Route shim for explicitly supported local CRUD. External actions return 501, never fake success. */
export async function handleLocalApi(req: Request, pathname?: string, options: StoreOptions = {}) {
  try {
    localGuard(req);
    const url = new URL(req.url), path = pathname || url.searchParams.get("path") || url.pathname, method = req.method;
    if (path === "/api/starter/export" && method === "GET") return json(await localTransaction(db => db, options, false));
    const data = ["GET", "HEAD"].includes(method) ? {} : await body(req);
    if (["/api/admin/campaign-proposal", "/api/admin/creative-brief"].includes(path) && ["GET", "PATCH"].includes(method)) return json(await localTransaction(db => {
      const isProposal = path.endsWith("campaign-proposal");
      const field = isProposal ? "proposal_markdown" : "creative_brief";
      const legacyField = isProposal ? "ai_vsl_prompt" : "ai_static_prompt";
      const prefix = isProposal ? "PROPOSAL_JSON:" : "CREATIVE_BRIEF_JSON:";
      const campaignId = method === "GET" ? url.searchParams.get("campaign_id") : data.campaign_id;
      const campaign = db.tables.campaigns.find(r => r.id === campaignId); requireValue(campaign, "Campagne introuvable");
      if (method === "PATCH") {
        requireValue(typeof data[field] === "string" && data[field].length <= 150_000, "Contenu texte requis (150 000 caractères maximum)");
        campaign[field] = data[field]; campaign[legacyField] = prefix + data[field]; campaign.updated_at = timestamp();
      }
      const raw = campaign[legacyField];
      return { campaign: { id: campaign.id, [field]: campaign[field] ?? (typeof raw === "string" && raw.startsWith(prefix) ? raw.slice(prefix.length) : null) } };
    }, options, method === "PATCH"));
    if (["/api/admin/ai-deliverables", "/api/admin/ai-deliverables/download"].includes(path) && method === "GET") {
      if (path.endsWith("/download")) {
        const deliverable = await localTransaction(db => db.tables.ai_deliverables.find(r => r.id === url.searchParams.get("id")), options, false);
        if (!deliverable) return json({ error: "Livrable introuvable" }, 404);
        if (typeof deliverable.content !== "string") return json({ error: "Aucun contenu local téléchargeable. Les chemins de fichiers et stockages distants ne sont jamais ouverts." }, 404);
        const name = text(deliverable.deliverable_name || deliverable.name || "livrable").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "livrable";
        return new Response(deliverable.content, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.txt"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }
      requireValue(url.searchParams.get("client_id"), "client_id requis");
      return json(await localTransaction(db => ({ deliverables: db.tables.ai_deliverables.filter(r => r.client_id === url.searchParams.get("client_id")).map(r => fields(r, ["id", "client_id", "campaign_id", "deliverable_name", "name", "title", "category", "file_type", "mime_type", "relative_path", "size_bytes", "created_at", "updated_at", "status", "source", "model"])) }), options, false));
    }
    if (path === "/api/admin/preview-client" && ["POST", "DELETE"].includes(method)) {
      if (method === "POST") await localTransaction(db => { requireValue(db.tables.profiles.some(r => r.id === data.client_id && r.role === "client"), "Client introuvable"); }, options, false);
      const response = json({ ok: true, local_only: true });
      response.headers.set("Set-Cookie", `lf_preview_client_id=${method === "POST" ? encodeURIComponent(data.client_id) : ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${method === "POST" ? 3600 : 0}`);
      return response;
    }
    if (["/api/admin/team-resources", "/api/team/resources"].includes(path) && method === "GET") return json(await localTransaction(db => {
      let resources = db.tables.team_resources;
      if (path === "/api/team/resources") { const assigned = new Set(db.tables.team_resource_assignments.filter(a => a.team_member_id === LOCAL_ADMIN_ID).map(a => a.resource_id)); resources = resources.filter(r => r.is_published && assigned.has(r.id)); }
      return { resources: [...resources].sort((a, b) => a.order_index - b.order_index).map(resource => ({ ...resource, assignee_ids: db.tables.team_resource_assignments.filter(a => a.resource_id === resource.id).map(a => a.team_member_id) })) };
    }, options, false));
    if (path === "/api/admin/team-resources" && method === "POST") return json(await localTransaction(db => {
      requireValue(text(data.title), "Titre requis");
      const resource = row({ created_by: LOCAL_ADMIN_ID, kind: "resource", is_published: true, order_index: Math.min(1, ...db.tables.team_resources.map(r => Number(r.order_index) || 0)) - 1, ...resourceFields(data) }); db.tables.team_resources.push(resource); return { resource };
    }, options));
    if (path === "/api/admin/team-resources" && method === "PATCH") return json(await localTransaction(db => {
      const resource = db.tables.team_resources.find(r => r.id === data.id); requireValue(resource, "Ressource introuvable"); Object.assign(resource, resourceFields(data), { updated_at: timestamp() }); return { resource };
    }, options));
    if (path === "/api/admin/team-resources" && method === "DELETE") return json(await localTransaction(db => {
      const id = url.searchParams.get("id"); requireValue(db.tables.team_resources.some(r => r.id === id), "Ressource introuvable"); db.tables.team_resources = db.tables.team_resources.filter(r => r.id !== id); db.tables.team_resource_assignments = db.tables.team_resource_assignments.filter(r => r.resource_id !== id); return { success: true };
    }, options));
    if (path === "/api/admin/team-resources/assign" && method === "POST") return json(await localTransaction(db => {
      requireValue(db.tables.team_resources.some(r => r.id === data.resource_id), "Ressource introuvable");
      requireValue(Array.isArray(data.member_ids), "Liste de membres requise"); const ids = [...new Set<string>(data.member_ids.map(String))];
      requireValue(ids.every(id => db.tables.profiles.some(r => r.id === id && r.role === "admin")), "Membre inconnu");
      const previous = db.tables.team_resource_assignments.filter(r => r.resource_id === data.resource_id).map(r => r.team_member_id);
      db.tables.team_resource_assignments = db.tables.team_resource_assignments.filter(r => r.resource_id !== data.resource_id);
      db.tables.team_resource_assignments.push(...ids.map(team_member_id => row({ resource_id: data.resource_id, team_member_id, assigned_by: LOCAL_ADMIN_ID })));
      return { success: true, added: ids.filter(id => !previous.includes(id)).length, removed: previous.filter(id => !ids.includes(id)).length };
    }, options));
    if (path === "/api/admin/client-notes" && method === "GET") return json(await localTransaction(db => ({ notes: db.tables.client_notes.filter(r => r.campaign_id === url.searchParams.get("campaign_id")).sort((a, b) => b.created_at.localeCompare(a.created_at)) }), options, false));
    if (path === "/api/admin/client-notes" && method === "POST") return json(await localTransaction(db => {
      const campaign = db.tables.campaigns.find(r => r.id === data.campaign_id && r.client_id === data.client_id); requireValue(campaign && text(data.content), "Campagne, client et message requis");
      const note = row({ campaign_id: campaign.id, client_id: campaign.client_id, content: text(data.content), is_read: false }); db.tables.client_notes.push(note); return { note, local_only: true, email_sent: false };
    }, options));
    if (path === "/api/client/notes" && ["GET", "PATCH"].includes(method)) {
      const rawId = req.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith("lf_preview_client_id="))?.slice("lf_preview_client_id=".length);
      const clientId = rawId ? decodeURIComponent(rawId) : null;
      return json(await localTransaction(db => {
        requireValue(clientId && db.tables.profiles.some(r => r.id === clientId && r.role === "client"), "Sélectionner un client en aperçu local");
        let notes = db.tables.client_notes.filter(r => r.client_id === clientId);
        if (method === "PATCH") { if (Array.isArray(data.ids) && data.ids.length) notes = notes.filter(r => data.ids.includes(r.id)); notes.forEach(r => r.is_read = true); return { ok: true }; }
        if (url.searchParams.get("unread") === "true") notes = notes.filter(r => !r.is_read);
        if (url.searchParams.get("campaign_id")) notes = notes.filter(r => r.campaign_id === url.searchParams.get("campaign_id"));
        return { notes: notes.sort((a, b) => b.created_at.localeCompare(a.created_at)) };
      }, options, method === "PATCH"));
    }
    if (path === "/api/admin/create-client" && method === "POST") {
      const result = await localTransaction(db => {
        const client = newClient(db, data);
        let campaign: any = null;
        if (text(data.ad_account_id)) { campaign = row({ client_id: client.id, name: `Campagne Meta — ${client.company}`, platform: "meta", status: "meta_account_setup", ad_account_id: text(data.ad_account_id).replace(/^act_/, ""), managed_by: LOCAL_ADMIN_ID }); db.tables.campaigns.push(campaign); }
        return { success: true, client_id: client.id, campaign_id: campaign?.id || null, email: client.email, local_only: true, message: "Fiche locale créée. Aucun compte distant ni email envoyé." };
      }, options); return json(result);
    }
    if (path === "/api/admin/update-client" && method === "PATCH") return json(await localTransaction(db => {
      const client = db.tables.profiles.find(r => r.id === data.client_id && r.role === "client"); requireValue(client, "Client introuvable");
      Object.assign(client, fields(data, ["full_name", "company", "phone", "is_active", "next_catchup", "results_rating", "results_rating_note"]), { updated_at: timestamp() }); return { success: true };
    }, options));
    if (path === "/api/admin/update-campaign" && method === "PATCH") return json(await localTransaction(db => {
      const campaign = db.tables.campaigns.find(r => r.id === data.campaign_id); requireValue(campaign, "Campagne introuvable");
      if (data.weekly_report_enabled === true) throw new Error("Envoi automatique déconnecté dans le starter");
      Object.assign(campaign, fields(data, ["status", "notes", "weekly_report_enabled", "name", "budget_monthly"]), { updated_at: timestamp() }); return { success: true };
    }, options));
    if (path === "/api/admin/team-members" && method === "POST") return json(await localTransaction(db => {
      requireValue(text(data.full_name) && text(data.email), "Nom et email requis");
      requireValue(["admin", "designer", "media_buyer"].includes(data.team_role), "Rôle invalide");
      const status = data.team_status || "active"; requireValue(["active", "invited", "disabled"].includes(status), "Statut invalide");
      const email = text(data.email).toLowerCase(); requireValue(!db.tables.profiles.some(r => r.email === email), "Adresse déjà présente");
      const member = row({ email, full_name: text(data.full_name), role: "admin", team_role: data.team_role, team_status: status, is_active: status !== "disabled", is_super_admin: false }); db.tables.profiles.push(member);
      return { member, schema_mode: "team", local_only: true, message: "Membre enregistré localement. Aucun compte distant ni invitation envoyée." };
    }, options));
    const memberId = path.match(/^\/api\/admin\/team-members\/([^/]+)$/)?.[1];
    if (memberId && method === "PUT") return json(await localTransaction(db => {
      const member = db.tables.profiles.find(r => r.id === memberId && r.role === "admin" && !r.is_super_admin); requireValue(member, "Membre modifiable introuvable");
      requireValue(text(data.full_name), "Nom requis"); requireValue(["admin", "designer", "media_buyer"].includes(data.team_role), "Rôle invalide"); requireValue(["active", "invited", "disabled"].includes(data.team_status), "Statut invalide");
      const ids = [...new Set<string>(Array.isArray(data.assigned_campaign_ids) ? data.assigned_campaign_ids.map(String) : [])];
      const campaigns = db.tables.campaigns.filter(c => ids.includes(c.id)); requireValue(campaigns.length === ids.length, "Campagne inconnue");
      const clients = new Set(campaigns.map(c => c.client_id));
      const rates = Array.isArray(data.client_rates) ? data.client_rates : [];
      for (const rate of rates) requireValue(clients.has(rate.client_id) && Number.isFinite(Number(rate.monthly_rate)) && Number(rate.monthly_rate) >= 0, "Tarif ou client invalide");
      Object.assign(member, { full_name: text(data.full_name), team_role: data.team_role, team_status: data.team_status, is_active: data.team_status !== "disabled", updated_at: timestamp() });
      db.tables.campaign_team_members = db.tables.campaign_team_members.filter(a => a.team_member_id !== memberId);
      db.tables.team_member_client_rates = db.tables.team_member_client_rates.filter(a => a.team_member_id !== memberId);
      db.tables.campaign_team_members.push(...ids.map(campaign_id => row({ campaign_id, team_member_id: memberId, assigned_by: LOCAL_ADMIN_ID })));
      db.tables.team_member_client_rates.push(...rates.map((rate: any) => row({ client_id: rate.client_id, team_member_id: memberId, monthly_rate: Number(rate.monthly_rate), notes: text(rate.notes) })));
      return { success: true, schema_mode: "team", local_only: true };
    }, options));
    if (path === "/api/onboarding/submit" && method === "POST") return json(await localTransaction(db => {
      requireValue(data.responses && typeof data.responses === "object" && !Array.isArray(data.responses), "Réponses requises");
      const responses = stripCredentials(data.responses); rejectSecrets(responses);
      const onboarding = row({ questionnaire_type: data.flow === "signup" ? "signup" : "leadfactory", responses, submitted_at: timestamp(), client_id: null, campaign_id: null }); db.tables.onboarding_responses.push(onboarding);
      if (data.flow === "signup") return { success: true, onboardingId: onboarding.id, local_only: true };
      requireValue(text(responses.a_entreprise), "Nom de l'entreprise requis");
      const client = newClient(db, { full_name: responses.a_entreprise, company: responses.a_entreprise, email: responses.i_email || responses.email || "" });
      const campaign = createBriefCampaign(db, onboarding, client);
      return { success: true, auto_client: true, client_id: client.id, campaign_id: campaign.id, onboardingId: onboarding.id, local_only: true, automation: "disconnected", message: "Brief, client et campagne enregistrés localement. Aucun envoi ni agent externe déclenché." };
    }, options));
    if (path === "/api/onboarding/finalize" && method === "POST") return json(await localTransaction(db => {
      const onboarding = db.tables.onboarding_responses.find(r => r.id === data.onboarding_id && r.questionnaire_type === "signup"); requireValue(onboarding, "Brief introuvable"); requireValue(!onboarding.client_id, "Brief déjà finalisé");
      const name = text(data.full_name) || text(onboarding.responses.company) || "Nouveau client";
      const client = newClient(db, { full_name: name, company: name, email: data.email }); const campaign = createBriefCampaign(db, onboarding, client);
      return { success: true, user_id: client.id, campaign_id: campaign.id, onboarding_id: onboarding.id, local_only: true };
    }, options));
    if (path === "/api/admin/tasks" && method === "GET") return json(await localTransaction(db => ({ tasks: db.tables.client_tasks.filter(r => r.client_id === url.searchParams.get("client_id")) }), options, false));
    if (path === "/api/admin/tasks" && method === "POST") return json(await localTransaction(db => {
      requireValue(text(data.title) && db.tables.profiles.some(r => r.id === data.client_id && r.role === "client"), "Client et titre requis"); const task = row({ title: text(data.title), description: text(data.description), client_id: data.client_id, created_by: LOCAL_ADMIN_ID, is_completed: false }); db.tables.client_tasks.push(task); return { task };
    }, options));
    const taskId = path.match(/^\/api\/admin\/tasks\/([^/]+)$/)?.[1];
    if (taskId && method === "DELETE") return json(await localTransaction(db => { requireValue(db.tables.client_tasks.some(r => r.id === taskId), "Tâche introuvable"); db.tables.client_tasks = db.tables.client_tasks.filter(r => r.id !== taskId); return { success: true }; }, options));
    return json({ error: "Cette action nécessite une intégration non connectée. Consulter Start Here. Aucun appel externe ni envoi effectué.", code: "STARTER_DISCONNECTED" }, 501);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Action locale refusée" }, 400); }
}
