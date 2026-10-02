"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Eye, EyeOff, Trash2, BookOpen, Users } from "lucide-react";
import type { Formation } from "@/types";

interface FormationRow extends Formation {
  modules_count: number;
  clients_count: number;
}

interface Props {
  formations: FormationRow[];
}

export function FormationsAdminClient({ formations: initial }: Props) {
  const router = useRouter();
  const [formations, setFormations] = useState(initial);
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim() || !slug.trim()) return;
    setSaving(true);
    const res = await fetch("/api/admin/formations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, slug, description }),
    });
    if (res.ok) {
      setShowModal(false);
      setTitle("");
      setSlug("");
      setDescription("");
      router.refresh();
    }
    setSaving(false);
  };

  const togglePublished = async (id: string, is_published: boolean) => {
    await fetch("/api/admin/formations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_published }),
    });
    setFormations((prev) =>
      prev.map((f) => (f.id === id ? { ...f, is_published } : f))
    );
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer cette formation ?")) return;
    await fetch("/api/admin/formations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setFormations((prev) => prev.filter((f) => f.id !== id));
  };

  const autoSlug = (val: string) => {
    setTitle(val);
    setSlug(
      val
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
    );
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="sticker-yellow -rotate-1 inline-block mb-3">SUPER ADMIN</div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Formations</h1>
          <p className="text-lf-gray mt-1">Gérer les formations et modules de formation clients</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Nouvelle formation
        </button>
      </div>

      {formations.length === 0 ? (
        <div className="card-brutal p-12 text-center">
          <BookOpen className="w-12 h-12 mx-auto text-lf-gray mb-4" />
          <p className="text-lg font-bold">Aucune formation</p>
          <p className="text-sm text-lf-gray mt-1">Créez votre première formation pour commencer</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {formations.map((f) => (
            <div key={f.id} className="card-brutal p-5 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <span
                  className={`text-xs font-black uppercase px-2 py-1 border-2 border-black ${
                    f.is_published ? "bg-lf-green text-white" : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {f.is_published ? "Publié" : "Brouillon"}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => togglePublished(f.id, !f.is_published)}
                    className="p-1.5 hover:bg-gray-100 border-2 border-transparent hover:border-black transition-all"
                    title={f.is_published ? "Dépublier" : "Publier"}
                  >
                    {f.is_published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(f.id)}
                    className="p-1.5 hover:bg-red-50 text-red-500 border-2 border-transparent hover:border-red-300 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <Link href={`/admin/formations/${f.id}`} className="group flex-1">
                <h2 className="text-lg font-black uppercase tracking-tight group-hover:text-lf-blue transition-colors">
                  {f.title}
                </h2>
                {f.description && (
                  <p className="text-sm text-lf-gray mt-1 line-clamp-2">{f.description}</p>
                )}
              </Link>

              <div className="flex items-center gap-4 mt-4 pt-3 border-t-2 border-black/10">
                <span className="flex items-center gap-1 text-xs font-bold text-lf-gray">
                  <BookOpen className="w-3 h-3" />
                  {f.modules_count} modules
                </span>
                <span className="flex items-center gap-1 text-xs font-bold text-lf-gray">
                  <Users className="w-3 h-3" />
                  {f.clients_count} clients
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal création */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card-brutal p-6 w-full max-w-md">
            <h2 className="text-xl font-black uppercase tracking-tight mb-4">Nouvelle formation</h2>
            <div className="flex flex-col gap-3">
              <input
                className="input-brutal"
                placeholder="Titre de la formation"
                value={title}
                onChange={(e) => autoSlug(e.target.value)}
              />
              <input
                className="input-brutal"
                placeholder="Slug (URL)"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <textarea
                className="input-brutal"
                placeholder="Description (optionnel)"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 font-bold uppercase text-sm border-3 border-black hover:bg-gray-100 transition-colors"
              >
                Annuler
              </button>
              <button onClick={handleCreate} disabled={saving || !title.trim()} className="btn-primary !py-2">
                {saving ? "Création..." : "Créer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
