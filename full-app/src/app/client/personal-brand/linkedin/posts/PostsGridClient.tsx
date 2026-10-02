"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Check,
  Copy,
  FileStack,
  Hash,
  Linkedin,
  Loader2,
  Pencil,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { SchedulePostSheet } from "@/components/client/SchedulePostSheet";

interface PostItem {
  id: string;
  conversation_id: string;
  conversation_title: string;
  body: string;
  hook: string | null;
  framework: string | null;
  format: "text" | "carousel" | "poll" | "story";
  metrics: { length?: number };
  created_at: string;
}

interface Props {
  posts: PostItem[];
}

function lengthBand(length: number) {
  if (length < 800) return { label: "Court", cls: "bg-white" };
  if (length <= 1900) return { label: "Optimal", cls: "bg-lf-green text-white" };
  return { label: "Long", cls: "bg-lf-yellow" };
}

export function PostsGridClient({ posts: initialPosts }: Props) {
  const router = useRouter();
  const [posts, setPosts] = useState<PostItem[]>(initialPosts);
  const [openPost, setOpenPost] = useState<PostItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Resync si le parent re-render avec une nouvelle liste
  useEffect(() => {
    setPosts(initialPosts);
  }, [initialPosts]);

  const copyToClipboard = useCallback(async (id: string, body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleUpdated = useCallback(
    (id: string, patch: Partial<PostItem>) => {
      setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      if (openPost?.id === id) {
        setOpenPost((prev) => (prev ? { ...prev, ...patch } : prev));
      }
    },
    [openPost?.id]
  );

  const handleDeleted = useCallback(
    (id: string) => {
      setPosts((prev) => prev.filter((p) => p.id !== id));
      if (openPost?.id === id) setOpenPost(null);
    },
    [openPost?.id]
  );

  return (
    <div className="flex flex-col h-full bg-canvas">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 lg:px-6 h-[73px] border-b-3 border-black bg-canvas">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/client/personal-brand/linkedin"
            className="flex items-center justify-center w-10 h-10 bg-white text-lf-black border-3 border-black hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000] transition-all"
            title="Retour au générateur"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 bg-lf-blue border-3 border-black rounded-xl flex items-center justify-center flex-shrink-0">
            <FileStack className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base lg:text-lg font-black uppercase tracking-tight leading-none">
              Mes posts LinkedIn
            </h1>
            <p className="text-[10px] lg:text-xs font-black uppercase tracking-wider text-lf-gray mt-1">
              {posts.length} post{posts.length > 1 ? "s" : ""} généré{posts.length > 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-6">
        {posts.length === 0 ? (
          <div className="max-w-md mx-auto text-center py-16">
            <div className="w-16 h-16 bg-lf-yellow border-3 border-black mx-auto mb-4 flex items-center justify-center">
              <Linkedin className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-black uppercase tracking-tight mb-2">
              Aucun post pour l&apos;instant
            </h2>
            <p className="text-sm font-medium text-lf-gray mb-6">
              Lance un brief dans le générateur pour créer tes premiers posts LinkedIn.
            </p>
            <Link
              href="/client/personal-brand/linkedin"
              className="inline-flex items-center gap-2 px-5 py-3 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[3px_3px_0_#000] transition-all"
            >
              Ouvrir le générateur
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {posts.map((p) => {
              const length = p.metrics?.length ?? p.body.length;
              const band = lengthBand(length);
              return (
                <button
                  key={p.id}
                  onClick={() => setOpenPost(p)}
                  className="text-left card-brutal p-4 flex flex-col gap-3 bg-white hover:bg-lf-yellow hover:shadow-[6px_6px_0_#000] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.framework && (
                      <span className="text-[10px] font-black uppercase tracking-wider bg-lf-blue text-white px-2 py-1">
                        <Hash className="w-2.5 h-2.5 inline mr-0.5" />
                        {p.framework}
                      </span>
                    )}
                    <span className={`text-[10px] font-black uppercase tracking-wider border-2 border-black px-2 py-1 ${band.cls}`}>
                      {length} c
                    </span>
                  </div>

                  {p.hook && (
                    <p className="text-sm font-black line-clamp-3 leading-snug">
                      {p.hook}
                    </p>
                  )}

                  <p className="text-xs font-medium text-lf-gray line-clamp-4 leading-relaxed">
                    {p.body}
                  </p>

                  <div className="mt-auto pt-2 border-t-2 border-black/10 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-lf-gray truncate">
                      {new Date(p.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      {" · "}
                      {p.conversation_title}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal centré */}
      {openPost && (
        <PostModal
          post={openPost}
          copied={copiedId === openPost.id}
          onCopy={() => void copyToClipboard(openPost.id, openPost.body)}
          onClose={() => setOpenPost(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          onScheduledRefresh={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ─── PostModal ────────────────────────────────────────────────────

function PostModal({
  post,
  copied,
  onCopy,
  onClose,
  onUpdated,
  onDeleted,
  onScheduledRefresh,
}: {
  post: PostItem;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  onUpdated: (id: string, patch: Partial<PostItem>) => void;
  onDeleted: (id: string) => void;
  onScheduledRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [bodyDraft, setBodyDraft] = useState(post.body);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  useEffect(() => {
    setBodyDraft(post.body);
    setError(null);
  }, [post.id, post.body]);

  const displayBody = editing ? bodyDraft : post.body;
  const length = displayBody.length;
  const band = lengthBand(length);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/personal-brand/linkedin/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: bodyDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur");
        return;
      }
      const trimmed = bodyDraft.trim();
      onUpdated(post.id, { body: trimmed, metrics: { length: trimmed.length } });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Supprimer définitivement ce post ?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/client/personal-brand/linkedin/posts/${post.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Erreur");
        setDeleting(false);
        return;
      }
      onDeleted(post.id);
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-8">
      <div className="absolute inset-0 bg-black/50" onClick={editing ? undefined : onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-canvas border-3 border-black shadow-[8px_8px_0_#000] flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 border-b-3 border-black px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {post.framework && (
              <span className="text-[10px] font-black uppercase tracking-wider bg-lf-blue text-white px-2 py-1">
                <Hash className="w-2.5 h-2.5 inline mr-0.5" />
                {post.framework}
              </span>
            )}
            <span className={`text-[10px] font-black uppercase tracking-wider border-2 border-black px-2 py-1 ${band.cls}`}>
              {length} c · {band.label}
            </span>
            <span className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
              {new Date(post.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-lf-yellow border-3 border-black flex-shrink-0"
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Brief link */}
        <div className="flex-shrink-0 px-5 py-2 bg-white border-b-3 border-black">
          <Link
            href={`/client/personal-brand/linkedin?conversation=${post.conversation_id}`}
            className="text-[10px] font-black uppercase tracking-wider text-lf-gray hover:text-lf-blue truncate block"
            title="Ouvrir le brief associé"
          >
            Brief · {post.conversation_title}
          </Link>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {post.hook && !editing && (
            <div className="border-l-3 border-lf-blue pl-3 mb-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
                Hook
              </p>
              <p className="text-base font-black">{post.hook}</p>
            </div>
          )}
          {editing ? (
            <textarea
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
              className="w-full min-h-[400px] border-3 border-black p-3 text-sm font-medium leading-relaxed focus:outline-none focus:bg-lf-yellow/5 resize-y font-mono"
              disabled={saving}
              autoFocus
            />
          ) : (
            <div className="text-sm font-medium whitespace-pre-wrap leading-relaxed">
              {post.body}
            </div>
          )}
          {error && (
            <p className="text-xs font-bold text-red-600 mt-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t-3 border-black px-5 py-3 flex flex-wrap items-center justify-between gap-2 bg-white">
          {/* Actions destructives à gauche */}
          <button
            onClick={handleDelete}
            disabled={deleting || saving}
            className="flex items-center gap-2 px-3 py-2 border-3 border-black bg-white text-red-500 font-black text-xs uppercase tracking-wider hover:bg-red-50 hover:border-red-500 transition-all disabled:opacity-50"
            title="Supprimer ce post"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Supprimer
          </button>

          {/* Actions principales à droite */}
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => {
                    setEditing(false);
                    setBodyDraft(post.body);
                    setError(null);
                  }}
                  disabled={saving}
                  className="flex items-center gap-2 px-3 py-2 border-3 border-black bg-white font-black text-xs uppercase tracking-wider hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || bodyDraft.trim().length === 0 || bodyDraft.trim() === post.body.trim()}
                  className="flex items-center gap-2 px-4 py-2 border-3 border-black bg-lf-green text-white font-black text-xs uppercase tracking-wider hover:shadow-[3px_3px_0_#000] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Enregistrer
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-2 px-3 py-2 border-3 border-black bg-white font-black text-xs uppercase tracking-wider hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000] transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Modifier
                </button>
                <button
                  onClick={onCopy}
                  className={`flex items-center gap-2 px-3 py-2 border-3 border-black font-black text-xs uppercase tracking-wider transition-all ${
                    copied
                      ? "bg-lf-green text-white"
                      : "bg-white hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000]"
                  }`}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copié !" : "Copier"}
                </button>
                <button
                  onClick={() => setScheduleOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 border-3 border-black bg-lf-black text-white font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[3px_3px_0_#000] transition-all"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Programmer / Publier
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sheet de scheduling LinkedIn */}
      <SchedulePostSheet
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        postBody={post.body}
        sourceType="linkedin_post"
        sourceId={post.id}
        onScheduled={() => {
          setScheduleOpen(false);
          onScheduledRefresh();
        }}
      />
    </div>
  );
}
