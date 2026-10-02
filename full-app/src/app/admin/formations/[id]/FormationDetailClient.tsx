"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Save, Eye, EyeOff,
  UserPlus, X, BookOpen, Users, BarChart2,
} from "lucide-react";
import type { Formation, FormationModule, ClientFormationAccess, ClientFormationProgress } from "@/types";

interface ClientProfile {
  id: string;
  full_name: string;
  company: string | null;
  email: string;
}

interface AccessRow extends ClientFormationAccess {
  profiles: ClientProfile;
}

interface Props {
  formation: Formation;
  modules: FormationModule[];
  access: AccessRow[];
  allClients: ClientProfile[];
  progress: ClientFormationProgress[];
}

export function FormationDetailClient({ formation: init, modules: initModules, access: initAccess, allClients, progress }: Props) {
  const router = useRouter();
  const [formation, setFormation] = useState(init);
  const [modules, setModules] = useState(initModules);
  const [access, setAccess] = useState(initAccess);
  const [saving, setSaving] = useState(false);
  const [editTitle, setEditTitle] = useState(formation.title);
  const [editDesc, setEditDesc] = useState(formation.description ?? "");

  // Module form
  const [showModuleForm, setShowModuleForm] = useState(false);
  const [editingModule, setEditingModule] = useState<FormationModule | null>(null);
  const [mTitle, setMTitle] = useState("");
  const [mDesc, setMDesc] = useState("");
  const [mVideo, setMVideo] = useState("");
  const [mPresentation, setMPresentation] = useState("");
  const [mDuration, setMDuration] = useState("");
  const [mNotes, setMNotes] = useState("");
  const [mResources, setMResources] = useState<{ label: string; url: string }[]>([]);

  // Client select
  const [selectedClient, setSelectedClient] = useState("");

  const availableClients = allClients.filter((c) => !access.some((a) => a.client_id === c.id));

  const saveFormation = async () => {
    setSaving(true);
    const res = await fetch("/api/admin/formations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: formation.id, title: editTitle, description: editDesc }),
    });
    if (res.ok) {
      const { formation: updated } = await res.json();
      setFormation(updated);
    }
    setSaving(false);
  };

  const openModuleForm = (mod?: FormationModule) => {
    if (mod) {
      setEditingModule(mod);
      setMTitle(mod.title);
      setMDesc(mod.description ?? "");
      setMVideo(mod.video_url ?? "");
      setMPresentation(mod.presentation_url ?? "");
      setMDuration(mod.duration_minutes?.toString() ?? "");
      setMNotes(mod.notes ?? "");
      setMResources(mod.resources ?? []);
    } else {
      setEditingModule(null);
      setMTitle("");
      setMDesc("");
      setMVideo("");
      setMPresentation("");
      setMDuration("");
      setMNotes("");
      setMResources([]);
    }
    setShowModuleForm(true);
  };

  const saveModule = async () => {
    setSaving(true);
    const body = {
      ...(editingModule ? { id: editingModule.id } : { formation_id: formation.id }),
      title: mTitle,
      description: mDesc || null,
      video_url: mVideo || null,
      presentation_url: mPresentation || null,
      duration_minutes: mDuration ? parseInt(mDuration) : null,
      notes: mNotes || null,
      resources: mResources.filter((r) => r.label && r.url),
      module_number: editingModule ? editingModule.module_number : modules.length + 1,
      display_order: editingModule ? editingModule.display_order : modules.length,
    };

    const res = await fetch("/api/admin/formations/modules", {
      method: editingModule ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setShowModuleForm(false);
      router.refresh();
    }
    setSaving(false);
  };

  const deleteModule = async (id: string) => {
    if (!confirm("Supprimer ce module ?")) return;
    await fetch("/api/admin/formations/modules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setModules((prev) => prev.filter((m) => m.id !== id));
  };

  const moveModule = async (id: string, direction: "up" | "down") => {
    const idx = modules.findIndex((m) => m.id === id);
    if ((direction === "up" && idx === 0) || (direction === "down" && idx === modules.length - 1)) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const updated = [...modules];
    [updated[idx], updated[swapIdx]] = [updated[swapIdx], updated[idx]];

    // Update display_order for both
    await Promise.all([
      fetch("/api/admin/formations/modules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: updated[idx].id, display_order: idx, module_number: idx + 1 }),
      }),
      fetch("/api/admin/formations/modules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: updated[swapIdx].id, display_order: swapIdx, module_number: swapIdx + 1 }),
      }),
    ]);
    setModules(updated.map((m, i) => ({ ...m, display_order: i, module_number: i + 1 })));
  };

  const grantAccess = async () => {
    if (!selectedClient) return;
    const res = await fetch("/api/admin/formations/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: selectedClient, formation_id: formation.id }),
    });
    if (res.ok) {
      setSelectedClient("");
      router.refresh();
    }
  };

  const revokeAccess = async (clientId: string) => {
    await fetch("/api/admin/formations/access", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, formation_id: formation.id }),
    });
    setAccess((prev) => prev.filter((a) => a.client_id !== clientId));
  };

  const getModuleProgress = (moduleId: string) => {
    const completedCount = progress.filter((p) => p.module_id === moduleId && p.is_completed).length;
    const totalClients = access.length;
    return { completedCount, totalClients };
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <Link href="/admin/formations" className="flex items-center gap-2 text-sm font-bold text-lf-gray hover:text-black mb-4">
        <ArrowLeft className="w-4 h-4" />
        Retour aux formations
      </Link>

      <div className="sticker-yellow -rotate-1 inline-block mb-3">FORMATION</div>

      {/* Éditer formation */}
      <div className="card-brutal p-6 mb-6">
        <div className="flex flex-col gap-3">
          <input className="input-brutal text-xl font-black" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          <textarea className="input-brutal" rows={2} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Description" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-lf-gray">Slug : <code className="bg-gray-100 px-2 py-0.5 border border-black">{formation.slug}</code></span>
            <button onClick={saveFormation} disabled={saving} className="btn-primary !py-2 !px-4 flex items-center gap-2">
              <Save className="w-4 h-4" />
              {saving ? "Sauvegarde..." : "Sauvegarder"}
            </button>
          </div>
        </div>
      </div>

      {/* Modules */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Modules ({modules.length})
        </h2>
        <button onClick={() => openModuleForm()} className="btn-primary !py-2 !px-4 flex items-center gap-2 !text-xs">
          <Plus className="w-3 h-3" />
          Ajouter un module
        </button>
      </div>

      <div className="flex flex-col gap-3 mb-8">
        {modules.map((mod, i) => {
          const { completedCount, totalClients } = getModuleProgress(mod.id);
          return (
            <div key={mod.id} className="card-brutal p-4">
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveModule(mod.id, "up")} disabled={i === 0} className="p-0.5 hover:text-lf-blue disabled:opacity-20">
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button onClick={() => moveModule(mod.id, "down")} disabled={i === modules.length - 1} className="p-0.5 hover:text-lf-blue disabled:opacity-20">
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-lf-gray">#{mod.module_number}</span>
                    <span className="font-bold">{mod.title}</span>
                    {mod.duration_minutes && <span className="text-xs text-lf-gray">{mod.duration_minutes} min</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-lf-gray">
                    {mod.video_url && <span>Video</span>}
                    {mod.presentation_url && <span>Présentation</span>}
                    {mod.resources && mod.resources.length > 0 && <span>{mod.resources.length} ressource(s)</span>}
                    {totalClients > 0 && (
                      <span className="flex items-center gap-1">
                        <BarChart2 className="w-3 h-3" />
                        {completedCount}/{totalClients} complété
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button onClick={() => openModuleForm(mod)} className="p-1.5 hover:bg-gray-100 border-2 border-transparent hover:border-black text-xs font-bold">
                    Éditer
                  </button>
                  <button onClick={() => deleteModule(mod.id)} className="p-1.5 hover:bg-red-50 text-red-500 border-2 border-transparent hover:border-red-300">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Accès clients */}
      <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2 mb-4">
        <Users className="w-5 h-5" />
        Accès clients ({access.length})
      </h2>

      <div className="card-brutal p-4 mb-4">
        <div className="flex items-center gap-2">
          <select className="input-brutal flex-1" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
            <option value="">Sélectionner un client...</option>
            {availableClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name} {c.company ? `(${c.company})` : ""}
              </option>
            ))}
          </select>
          <button onClick={grantAccess} disabled={!selectedClient} className="btn-primary !py-3 !px-4 flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            Ajouter
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 mb-8">
        {access.map((a) => (
          <div key={a.id} className="card-brutal-sm p-3 flex items-center justify-between">
            <div>
              <span className="font-bold">{a.profiles?.full_name}</span>
              {a.profiles?.company && <span className="text-sm text-lf-gray ml-2">({a.profiles.company})</span>}
              <span className="text-xs text-lf-gray ml-2">{a.profiles?.email}</span>
            </div>
            <button onClick={() => revokeAccess(a.client_id)} className="p-1.5 hover:bg-red-50 text-red-500 border-2 border-transparent hover:border-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        {access.length === 0 && (
          <p className="text-sm text-lf-gray text-center py-4">Aucun client n&apos;a accès à cette formation</p>
        )}
      </div>

      {/* Modal module */}
      {showModuleForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="card-brutal p-6 w-full max-w-lg my-8">
            <h2 className="text-xl font-black uppercase tracking-tight mb-4">
              {editingModule ? "Éditer le module" : "Nouveau module"}
            </h2>
            <div className="flex flex-col gap-3">
              <input className="input-brutal" placeholder="Titre du module" value={mTitle} onChange={(e) => setMTitle(e.target.value)} />
              <textarea className="input-brutal" placeholder="Description" rows={2} value={mDesc} onChange={(e) => setMDesc(e.target.value)} />
              <input className="input-brutal" placeholder="URL Vidéo (Google Drive)" value={mVideo} onChange={(e) => setMVideo(e.target.value)} />
              <input className="input-brutal" placeholder="URL Présentation (Vercel)" value={mPresentation} onChange={(e) => setMPresentation(e.target.value)} />
              <input className="input-brutal" placeholder="Durée (minutes)" type="number" value={mDuration} onChange={(e) => setMDuration(e.target.value)} />
              <textarea className="input-brutal" placeholder="Notes" rows={2} value={mNotes} onChange={(e) => setMNotes(e.target.value)} />

              {/* Ressources dynamiques */}
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2">Ressources</p>
                {mResources.map((r, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      className="input-brutal flex-1"
                      placeholder="Label"
                      value={r.label}
                      onChange={(e) => {
                        const updated = [...mResources];
                        updated[i] = { ...updated[i], label: e.target.value };
                        setMResources(updated);
                      }}
                    />
                    <input
                      className="input-brutal flex-1"
                      placeholder="URL"
                      value={r.url}
                      onChange={(e) => {
                        const updated = [...mResources];
                        updated[i] = { ...updated[i], url: e.target.value };
                        setMResources(updated);
                      }}
                    />
                    <button onClick={() => setMResources((prev) => prev.filter((_, j) => j !== i))} className="text-red-500 px-2">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setMResources((prev) => [...prev, { label: "", url: "" }])}
                  className="text-xs font-bold text-lf-blue hover:underline"
                >
                  + Ajouter une ressource
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowModuleForm(false)} className="px-4 py-2 font-bold uppercase text-sm border-3 border-black hover:bg-gray-100">
                Annuler
              </button>
              <button onClick={saveModule} disabled={saving || !mTitle.trim()} className="btn-primary !py-2">
                {saving ? "Sauvegarde..." : editingModule ? "Mettre à jour" : "Créer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
