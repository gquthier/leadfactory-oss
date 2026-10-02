"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AlertCircle,
  Bold,
  Check,
  FileText,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Underline as UnderlineIcon,
  Users,
  Video,
  X,
} from "lucide-react";
import type { TeamDashboardMember, TeamResourceKind, TeamResourceWithAssignees } from "@/types/index";
import { toLoomEmbedUrl } from "@/lib/team-resources/loom";
import { TeamResourceView } from "@/components/team/TeamResourceView";

type Draft = {
  id: string | null;
  kind: TeamResourceKind;
  title: string;
  loom_url: string;
  document_url: string;
  body_html: string;
  is_published: boolean;
  assignee_ids: string[];
};

function emptyDraft(): Draft {
  return {
    id: null,
    kind: "sop",
    title: "",
    loom_url: "",
    document_url: "",
    body_html: "",
    is_published: true,
    assignee_ids: [],
  };
}

function kindBadge(kind: TeamResourceKind) {
  return kind === "sop"
    ? { label: "SOP", cls: "bg-lf-blue text-white border-lf-blue" }
    : { label: "Ressource", cls: "bg-lf-pink text-black border-black" };
}

/* -------------------------------------------------------------------------- */
/*  Toolbar TipTap                                                            */
/* -------------------------------------------------------------------------- */

function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const btn = (active: boolean) =>
    `p-1.5 border-2 border-black transition-all ${active ? "bg-lf-black text-white" : "bg-white hover:bg-gray-100"}`;

  return (
    <div className="flex flex-wrap gap-1 border-b-3 border-black bg-gray-50 px-3 py-2">
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive("bold"))} title="Gras">
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive("italic"))} title="Italique">
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive("underline"))} title="Souligné">
        <UnderlineIcon className="h-3.5 w-3.5" />
      </button>
      <div className="mx-1 w-px bg-black" />
      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive("bulletList"))} title="Liste à puces">
        <List className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive("orderedList"))} title="Liste numérotée">
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Slide-over éditeur                                                        */
/* -------------------------------------------------------------------------- */

function ResourceEditor({
  draft,
  members,
  onClose,
  onSaved,
}: {
  draft: Draft;
  members: TeamDashboardMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Draft>(draft);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({
        placeholder: "Texte libre : consignes, liens, accès, mots de passe…",
      }),
    ],
    content: form.body_html || "",
    onUpdate: ({ editor: e }) => setField("body_html", e.getHTML()),
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none p-4 min-h-[160px] focus:outline-none [&_a]:text-lf-blue [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_li]:my-0.5",
      },
    },
  });

  const loomEmbed = useMemo(() => toLoomEmbedUrl(form.loom_url), [form.loom_url]);
  const loomInvalid = form.loom_url.trim() !== "" && !loomEmbed;

  const toggleMember = (id: string) =>
    setField(
      "assignee_ids",
      form.assignee_ids.includes(id)
        ? form.assignee_ids.filter((m) => m !== id)
        : [...form.assignee_ids, id],
    );

  const handleSave = async () => {
    if (!form.title.trim()) {
      setErr("Le titre est requis.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      // 1) Créer ou mettre à jour la ressource.
      const payload = {
        id: form.id ?? undefined,
        kind: form.kind,
        title: form.title.trim(),
        loom_url: form.loom_url.trim() || null,
        document_url: form.document_url.trim() || null,
        body_html: form.body_html,
        body_text: editor?.getText() ?? null,
        is_published: form.is_published,
      };
      const res = await fetch("/api/admin/team-resources", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Échec de l'enregistrement");
      }
      const { resource } = await res.json();
      const resourceId = resource.id as string;

      // 2) Synchroniser les attributions.
      const aRes = await fetch("/api/admin/team-resources/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource_id: resourceId, member_ids: form.assignee_ids }),
      });
      if (!aRes.ok) {
        const j = await aRes.json().catch(() => ({}));
        throw new Error(j.error || "Ressource enregistrée mais attribution échouée");
      }

      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2 text-sm border-3 border-black bg-white focus:outline-none focus:border-lf-blue transition-colors";
  const labelCls = "text-[11px] font-black uppercase tracking-wider text-lf-gray mb-1 block";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative flex h-full w-full max-w-2xl flex-col border-l-3 border-black bg-canvas shadow-brutal">
        {/* Header */}
        <div className="flex items-center justify-between border-b-3 border-black bg-gray-50 px-5 py-4">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            <h3 className="text-sm font-black uppercase tracking-wider">
              {form.id ? "Modifier la ressource" : "Nouvelle ressource"}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="border-2 border-black bg-white p-1.5 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Type + Titre */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_1fr]">
            <div>
              <label className={labelCls}>Type</label>
              <select
                value={form.kind}
                onChange={(e) => setField("kind", e.target.value as TeamResourceKind)}
                className={inputCls}
              >
                <option value="sop">SOP</option>
                <option value="resource">Ressource</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Titre</label>
              <input
                className={inputCls}
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
                placeholder="Ex : SOP — Onboarding d'un nouveau client"
              />
            </div>
          </div>

          {/* Bloc 1 — Loom */}
          <div>
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1">
                <Video className="h-3 w-3" /> Lien Loom (embed)
              </span>
            </label>
            <input
              className={inputCls}
              value={form.loom_url}
              onChange={(e) => setField("loom_url", e.target.value)}
              placeholder="https://www.loom.com"
            />
            {loomInvalid && (
              <p className="mt-1 flex items-center gap-1 text-xs font-bold text-red-600">
                <AlertCircle className="h-3 w-3" /> Lien Loom non reconnu.
              </p>
            )}
            {loomEmbed && (
              <div className="mt-3 border-3 border-black bg-black">
                <div className="relative w-full" style={{ paddingBottom: "62.5%" }}>
                  <iframe
                    src={loomEmbed}
                    title="Aperçu Loom"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full"
                    frameBorder={0}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Bloc 2 — Document */}
          <div>
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3 w-3" /> Lien vers un document
              </span>
            </label>
            <input
              className={inputCls}
              value={form.document_url}
              onChange={(e) => setField("document_url", e.target.value)}
              placeholder="https://drive.google.com"
            />
          </div>

          {/* Bloc 3 — Texte riche */}
          <div>
            <label className={labelCls}>Texte libre</label>
            <div className="border-3 border-black bg-white">
              <EditorToolbar editor={editor} />
              <EditorContent editor={editor} />
            </div>
          </div>

          {/* Attribution */}
          <div>
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" /> Attribuer à ({form.assignee_ids.length})
              </span>
            </label>
            <div className="max-h-56 overflow-y-auto border-3 border-black bg-white">
              {members.length === 0 ? (
                <div className="p-4 text-sm font-medium text-lf-gray">Aucun membre d'équipe.</div>
              ) : (
                members.map((m) => {
                  const checked = form.assignee_ids.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer items-center gap-3 border-b-2 border-black px-4 py-2.5 last:border-b-0 ${
                        checked ? "bg-lf-yellow/20" : "bg-white hover:bg-gray-50"
                      }`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleMember(m.id)} className="checkbox-brutal" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-black">{m.full_name}</span>
                        <span className="block text-xs font-medium text-lf-gray">{m.email}</span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Publication */}
          <label className="flex cursor-pointer items-center gap-3 border-3 border-black bg-white px-4 py-3">
            <input
              type="checkbox"
              checked={form.is_published}
              onChange={(e) => setField("is_published", e.target.checked)}
              className="checkbox-brutal"
            />
            <span className="text-sm font-bold">
              Publiée (visible par les membres attribués)
            </span>
          </label>

          {err && (
            <div className="flex items-start gap-2 border-3 border-red-400 bg-red-50 p-3 text-sm font-bold text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {err}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t-3 border-black bg-gray-50 px-5 py-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-white hover:bg-gray-100">
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 border-3 border-black bg-lf-green px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition-all hover:shadow-brutal disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panneau principal (liste)                                                 */
/* -------------------------------------------------------------------------- */

export function TeamResourcesPanel({ members }: { members: TeamDashboardMember[] }) {
  const [resources, setResources] = useState<TeamResourceWithAssignees[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.id, m.full_name);
    return map;
  }, [members]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await fetch("/api/admin/team-resources");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Chargement impossible");
      }
      const { resources } = await res.json();
      setResources(resources ?? []);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => setEditing(emptyDraft());
  const openEdit = (r: TeamResourceWithAssignees) =>
    setEditing({
      id: r.id,
      kind: r.kind,
      title: r.title,
      loom_url: r.loom_url ?? "",
      document_url: r.document_url ?? "",
      body_html: r.body_html ?? "",
      is_published: r.is_published,
      assignee_ids: r.assignee_ids,
    });

  const handleDelete = async (id: string) => {
    if (!window.confirm("Supprimer définitivement cette ressource ?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/team-resources?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      window.alert("Suppression impossible.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-black uppercase tracking-wider">Ressources & SOP</h2>
          <p className="text-sm font-medium text-lf-gray">
            Centralisez vos SOP, documents et accès, et attribuez-les à vos membres.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="flex items-center gap-2 self-start border-3 border-black bg-lf-green px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition-all hover:shadow-brutal"
        >
          <Plus className="h-4 w-4" /> Nouvelle ressource
        </button>
      </div>

      {loadErr && (
        <div className="flex items-start gap-2 border-3 border-red-400 bg-red-50 p-3 text-sm font-bold text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {loadErr}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 border-3 border-black bg-white p-6 text-sm font-bold">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : resources.length === 0 ? (
        <div className="border-3 border-dashed border-black bg-gray-50 p-8 text-center">
          <Video className="mx-auto mb-2 h-6 w-6 opacity-40" />
          <p className="text-sm font-bold">Aucune ressource pour le moment.</p>
          <p className="text-xs font-medium text-lf-gray">Cliquez sur « Nouvelle ressource » pour commencer.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {resources.map((r) => {
            const badge = kindBadge(r.kind);
            const isOpen = expanded === r.id;
            return (
              <div key={r.id} className="border-3 border-black bg-white">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className={`border-2 px-2 py-1 text-[10px] font-black uppercase tracking-wider ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black uppercase">{r.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] font-medium text-lf-gray">
                        {r.loom_url && <span className="inline-flex items-center gap-1"><Video className="h-3 w-3" /> Loom</span>}
                        {r.document_url && <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> Doc</span>}
                        <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {r.assignee_ids.length} attribué·s</span>
                        {!r.is_published && <span className="border border-orange-400 bg-orange-50 px-1.5 text-orange-700">Brouillon</span>}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="flex items-center gap-1.5 border-3 border-black bg-white px-3 py-1.5 text-xs font-black uppercase tracking-wider hover:bg-gray-100"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      disabled={deletingId === r.id}
                      className="border-3 border-black bg-white p-1.5 hover:bg-red-50 disabled:opacity-50"
                      title="Supprimer"
                    >
                      {deletingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-red-600" />}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t-3 border-black bg-gray-50 p-4">
                    {r.assignee_ids.length > 0 && (
                      <p className="mb-3 text-xs font-medium text-lf-gray">
                        Attribuée à : {r.assignee_ids.map((id) => memberName.get(id) ?? "—").join(", ")}
                      </p>
                    )}
                    <TeamResourceView resource={r} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ResourceEditor
          draft={editing}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
