"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Linkedin,
  Send,
  Sparkles,
  Loader2,
  Bot,
  User,
  Plus,
  MessageSquare,
  Info,
  X,
  Copy,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  Hash,
  FileStack,
  Pencil,
  Save,
  Trash2,
  Calendar,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { SchedulePostSheet } from "@/components/client/SchedulePostSheet";

interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface GeneratedPost {
  id: string;
  body: string;
  hook: string | null;
  framework: string | null;
  format: "text" | "carousel" | "poll" | "story";
  metrics: { length?: number };
}

interface Props {
  initialConversations: ConversationSummary[];
  initialActiveConversationId: string | null;
  initialMessages: ChatMessage[];
  initialPosts: GeneratedPost[];
  contextSummary: Array<{ label: string; value: string }>;
  hasOnboarding: boolean;
  firstName: string;
}

const SIDEBAR_STORAGE_KEY = "lf-linkedin-sidebar-collapsed";

const SUGGESTIONS = [
  "Génère-moi 3 posts LinkedIn qui parlent du problème principal de ma cible",
  "Écris-moi un post contrarian qui casse une croyance populaire de mon secteur",
  "Génère un post vulnérabilité où je raconte un échec et la leçon que j'en ai tirée",
  "Propose-moi un post liste : 5 erreurs que je vois chez mes prospects",
  "Donne-moi un post format question qui invite à la discussion en commentaires",
];

function stripPostBlocksFromText(text: string): string {
  return text.replace(/<linkedin-post[^>]*>[\s\S]*?<\/linkedin-post>/gi, "").trim();
}

export function LinkedInGeneratorClient({
  initialConversations,
  initialActiveConversationId,
  initialMessages,
  initialPosts,
  contextSummary,
  hasOnboarding,
  firstName,
}: Props) {
  const [conversations, setConversations] =
    useState<ConversationSummary[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    initialActiveConversationId
  );
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [posts, setPosts] = useState<GeneratedPost[]>(initialPosts);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const s = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (s === "1") setSidebarCollapsed(true);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const loadConversation = useCallback(async (id: string) => {
    setActiveConversationId(id);
    setShowHistory(false);
    try {
      const r = await fetch(
        `/api/client/personal-brand/linkedin/conversation?id=${id}`,
        { cache: "no-store" }
      );
      if (!r.ok) return;
      const data = (await r.json()) as {
        messages: ChatMessage[];
        posts: GeneratedPost[];
      };
      setMessages(data.messages ?? []);
      setPosts(data.posts ?? []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const newConversation = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setPosts([]);
    setInput("");
    setShowHistory(false);
    inputRef.current?.focus();
  }, []);

  const send = useCallback(async () => {
    const txt = input.trim();
    if (!txt || sending) return;

    setSending(true);
    const optimistic: ChatMessage = {
      role: "user",
      content: txt,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");

    try {
      const r = await fetch("/api/client/personal-brand/linkedin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: txt,
          conversation_id: activeConversationId,
        }),
      });

      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ ${err?.error ?? "Erreur IA, réessaie."}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      const data = (await r.json()) as {
        conversation_id: string;
        response: string;
        raw_response: string;
        posts: GeneratedPost[];
      };

      // Si c'est une nouvelle conversation, on l'ajoute en haut de la liste
      if (!activeConversationId) {
        setActiveConversationId(data.conversation_id);
        setConversations((prev) => [
          {
            id: data.conversation_id,
            title: txt.slice(0, 60),
            updated_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.raw_response,
          timestamp: new Date().toISOString(),
        },
      ]);
      if (data.posts && data.posts.length > 0) setPosts(data.posts);
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "⚠️ Erreur réseau, réessaie.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sending, activeConversationId]);

  const copyToClipboard = useCallback(async (id: string, body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handlePostUpdated = useCallback((id: string, patch: Partial<GeneratedPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const handlePostDeleted = useCallback((id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const isEmpty = messages.length === 0 && !sending;

  return (
    <div className="flex flex-col h-full bg-canvas">
      {/* ── HEADER local (page full-screen) ───────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 lg:px-6 h-[73px] border-b-3 border-black bg-canvas">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() =>
              window.dispatchEvent(new CustomEvent("lf-toggle-main-sidebar"))
            }
            className="flex items-center justify-center w-10 h-10 bg-white text-lf-black border-3 border-black hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000] transition-all"
            title="Menu principal"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>

          <div className="w-10 h-10 bg-lf-blue border-3 border-black rounded-xl flex items-center justify-center flex-shrink-0">
            <Linkedin className="w-5 h-5 text-white" />
          </div>

          <div className="min-w-0">
            <h1 className="text-base lg:text-lg font-black uppercase tracking-tight leading-none">
              Générateur LinkedIn
            </h1>
            <p className="text-[10px] lg:text-xs font-black uppercase tracking-wider text-lf-gray mt-1">
              Personal Brand IA · Opti LinkedIn
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowContext(true)}
            className="hidden lg:flex items-center gap-2 px-3 py-2 bg-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000] transition-all"
            title="Voir le contexte client"
          >
            <Info className="w-3.5 h-3.5" />
            Contexte
          </button>

          <Link
            href="/client/personal-brand/linkedin/posts"
            className="flex items-center gap-2 px-3 py-2 bg-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000] transition-all"
            title="Voir tous mes posts"
          >
            <FileStack className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Mes posts</span>
          </Link>

          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000] transition-all"
            title="Historique"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Historique</span>
            {conversations.length > 0 && (
              <span className="bg-lf-black text-white text-[10px] font-black px-1.5 py-0.5">
                {conversations.length}
              </span>
            )}
          </button>

          <button
            onClick={newConversation}
            className="flex items-center gap-2 px-3 py-2 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[3px_3px_0_#000] transition-all"
            title="Nouveau brief"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouveau</span>
          </button>
        </div>
      </div>

      {/* ── BODY 2-pane (chat + posts) ────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* CHAT pane */}
        <div className="flex-1 flex flex-col min-w-0 border-r-3 border-black">
          <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4 lg:py-6">
            {isEmpty ? (
              <EmptyState
                firstName={firstName}
                hasOnboarding={hasOnboarding}
                onPickSuggestion={(s) => {
                  setInput(s);
                  inputRef.current?.focus();
                }}
              />
            ) : (
              <div className="max-w-3xl mx-auto flex flex-col gap-6">
                {messages.map((m, i) => (
                  <ChatBubble key={i} msg={m} />
                ))}
                {sending && (
                  <div className="flex gap-3 items-start">
                    <div className="w-8 h-8 bg-lf-yellow border-3 border-black rounded-full flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="bg-white border-3 border-black p-4 inline-flex items-center gap-2 shadow-brutal-xs">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm font-medium">Opti rédige…</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex-shrink-0 border-t-3 border-black bg-white p-3 lg:p-4">
            <div className="max-w-3xl mx-auto">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Brief Opti : sujet, angle, framework souhaité…"
                  rows={2}
                  className="flex-1 px-3 py-2 border-3 border-black font-medium text-sm resize-none focus:outline-none focus:bg-lf-yellow/10"
                  disabled={sending}
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || !input.trim()}
                  className="flex items-center gap-2 px-4 py-3 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-blue hover:shadow-[3px_3px_0_#000] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-[10px] font-medium text-lf-gray mt-2">
                Enter = envoyer · Shift+Enter = saut de ligne
              </p>
            </div>
          </div>
        </div>

        {/* POSTS pane (visible si on a généré quelque chose) */}
        <div
          className={`hidden lg:flex flex-col flex-shrink-0 transition-[width] duration-200 ${
            posts.length > 0 || !sidebarCollapsed ? "w-[440px]" : "w-12"
          }`}
        >
          {posts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-6 text-center bg-canvas">
              <div className="w-12 h-12 bg-lf-yellow border-3 border-black rounded-xl flex items-center justify-center mb-3">
                <Sparkles className="w-6 h-6" />
              </div>
              <p className="font-black uppercase text-sm tracking-tight">
                Posts générés
              </p>
              <p className="text-xs font-medium text-lf-gray mt-2 max-w-[240px]">
                Ils apparaissent ici dès qu'Opti les rédige. Tu pourras les copier, éditer, planifier.
              </p>
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider">
                  {posts.length} post{posts.length > 1 ? "s" : ""} généré{posts.length > 1 ? "s" : ""}
                </span>
              </div>
              {posts.map((p, i) => (
                <PostCard
                  key={p.id}
                  index={i + 1}
                  post={p}
                  copied={copiedId === p.id}
                  onCopy={() => void copyToClipboard(p.id, p.body)}
                  onUpdated={handlePostUpdated}
                  onDeleted={handlePostDeleted}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── DRAWERS ──────────────────────────────────────────────── */}
      {showContext && (
        <ContextDrawer
          contextSummary={contextSummary}
          hasOnboarding={hasOnboarding}
          onClose={() => setShowContext(false)}
        />
      )}
      {showHistory && (
        <HistoryDrawer
          conversations={conversations}
          activeId={activeConversationId}
          onPick={(id) => void loadConversation(id)}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function EmptyState({
  firstName,
  hasOnboarding,
  onPickSuggestion,
}: {
  firstName: string;
  hasOnboarding: boolean;
  onPickSuggestion: (s: string) => void;
}) {
  return (
    <div className="max-w-2xl mx-auto py-6 lg:py-12">
      <div className="sticker-yellow -rotate-1 inline-block mb-4">
        OPTI LINKEDIN
      </div>
      <h2 className="text-2xl lg:text-3xl font-black uppercase tracking-tight mb-3">
        Salut {firstName}, on écrit quoi aujourd'hui ?
      </h2>
      <p className="text-lf-gray font-medium mb-6">
        Opti connaît déjà ton offre, ta promesse et ta cible (via ton onboarding). Donne-lui un
        angle, un sujet, ou choisis une suggestion ci-dessous.
      </p>

      {!hasOnboarding && (
        <div className="mb-6 p-4 bg-lf-yellow/30 border-3 border-black">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-black text-sm uppercase tracking-wide">
                Onboarding incomplet
              </p>
              <p className="text-sm font-medium mt-1">
                Opti peut quand même générer, mais la qualité sera meilleure avec ton onboarding rempli.
                Va dans <strong>Paramètres → Onboarding</strong>.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">
          Suggestions pour démarrer
        </p>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPickSuggestion(s)}
            className="text-left px-4 py-3 bg-white border-3 border-black font-medium text-sm hover:bg-lf-yellow hover:shadow-[4px_4px_0_#000] transition-all"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const cleaned = isUser ? msg.content : stripPostBlocksFromText(msg.content);

  // Si le message assistant ne contient que des blocs post (rien d'autre), on l'élide
  if (!isUser && !cleaned) return null;

  return (
    <div className={`flex gap-3 items-start ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-8 h-8 border-3 border-black rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? "bg-lf-blue text-white" : "bg-lf-yellow"
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div
        className={`max-w-[80%] border-3 border-black p-3 lg:p-4 shadow-brutal-xs ${
          isUser ? "bg-lf-blue text-white" : "bg-white"
        }`}
      >
        <div
          className={`prose prose-sm max-w-none ${
            isUser
              ? "prose-invert prose-strong:text-white"
              : "prose-strong:font-black"
          }`}
        >
          <ReactMarkdown>{cleaned}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function PostCard({
  index,
  post,
  copied,
  onCopy,
  onUpdated,
  onDeleted,
}: {
  index: number;
  post: GeneratedPost;
  copied: boolean;
  onCopy: () => void;
  onUpdated: (id: string, patch: Partial<GeneratedPost>) => void;
  onDeleted: (id: string) => void;
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
  const lengthBand =
    length < 800
      ? { label: "Court", cls: "bg-white" }
      : length <= 1900
      ? { label: "Optimal", cls: "bg-lf-green text-white" }
      : { label: "Long", cls: "bg-lf-yellow" };

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
    <div className="card-brutal p-4 flex flex-col gap-3 bg-white">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-wider bg-lf-black text-white px-2 py-1">
            Variante {index}
          </span>
          {post.framework && (
            <span className="text-[10px] font-black uppercase tracking-wider bg-lf-blue text-white px-2 py-1">
              <Hash className="w-2.5 h-2.5 inline mr-0.5" />
              {post.framework}
            </span>
          )}
          <span
            className={`text-[10px] font-black uppercase tracking-wider border-2 border-black px-2 py-1 ${lengthBand.cls}`}
          >
            {length} c · {lengthBand.label}
          </span>
        </div>
        <button
          onClick={onCopy}
          disabled={editing}
          className={`flex items-center justify-center w-8 h-8 border-3 border-black transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            copied
              ? "bg-lf-green text-white"
              : "bg-white hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000]"
          }`}
          title="Copier le post"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {post.hook && !editing && (
        <div className="border-l-3 border-lf-blue pl-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
            Hook
          </p>
          <p className="text-sm font-black">{post.hook}</p>
        </div>
      )}

      {editing ? (
        <textarea
          value={bodyDraft}
          onChange={(e) => setBodyDraft(e.target.value)}
          rows={14}
          disabled={saving}
          className="w-full border-3 border-black p-2 text-xs font-mono leading-relaxed focus:outline-none focus:bg-lf-yellow/5 resize-y"
          autoFocus
        />
      ) : (
        <div className="text-sm font-medium whitespace-pre-wrap leading-relaxed border-t-3 border-black pt-3">
          {post.body}
        </div>
      )}

      {error && <p className="text-[11px] font-bold text-red-600">{error}</p>}

      <div className="pt-2 border-t-2 border-black/10 flex items-center justify-between gap-2 flex-wrap">
        <button
          onClick={handleDelete}
          disabled={deleting || saving}
          className="flex items-center gap-1.5 px-2 py-1.5 border-2 border-black bg-white text-red-500 font-black text-[10px] uppercase tracking-wider hover:bg-red-50 hover:border-red-500 transition-all disabled:opacity-50"
          title="Supprimer ce post"
        >
          {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          Suppr.
        </button>

        <div className="flex items-center gap-1.5">
          {editing ? (
            <>
              <button
                onClick={() => {
                  setEditing(false);
                  setBodyDraft(post.body);
                  setError(null);
                }}
                disabled={saving}
                className="px-2 py-1.5 border-2 border-black bg-white font-black text-[10px] uppercase tracking-wider hover:bg-gray-100 transition-all disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={saving || bodyDraft.trim().length === 0 || bodyDraft.trim() === post.body.trim()}
                className="flex items-center gap-1.5 px-2 py-1.5 border-2 border-black bg-lf-green text-white font-black text-[10px] uppercase tracking-wider hover:shadow-[2px_2px_0_#000] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-2 py-1.5 border-2 border-black bg-white font-black text-[10px] uppercase tracking-wider hover:bg-lf-yellow transition-all"
              >
                <Pencil className="w-3 h-3" />
                Édit
              </button>
              <button
                onClick={() => setScheduleOpen(true)}
                className="flex items-center gap-1.5 px-2 py-1.5 border-2 border-black bg-lf-black text-white font-black text-[10px] uppercase tracking-wider hover:bg-lf-blue transition-all"
              >
                <Calendar className="w-3 h-3" />
                Programmer
              </button>
            </>
          )}
        </div>
      </div>

      <SchedulePostSheet
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        postBody={post.body}
        sourceType="linkedin_post"
        sourceId={post.id}
        onScheduled={() => setScheduleOpen(false)}
      />
    </div>
  );
}

function ContextDrawer({
  contextSummary,
  hasOnboarding,
  onClose,
}: {
  contextSummary: Array<{ label: string; value: string }>;
  hasOnboarding: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-canvas border-l-3 border-black h-full overflow-y-auto">
        <div className="sticky top-0 bg-canvas border-b-3 border-black px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
              Contexte injecté
            </p>
            <h3 className="font-black uppercase tracking-tight">Onboarding client</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-lf-yellow border-3 border-black">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {!hasOnboarding && (
            <div className="p-3 bg-lf-yellow/30 border-3 border-black">
              <p className="text-sm font-medium">
                Onboarding peu rempli — la qualité des posts sera limitée. Va dans Paramètres → Onboarding.
              </p>
            </div>
          )}
          {contextSummary.map((c) => (
            <div key={c.label}>
              <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
                {c.label}
              </p>
              <p className="text-sm font-medium">{c.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HistoryDrawer({
  conversations,
  activeId,
  onPick,
  onClose,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-canvas border-l-3 border-black h-full overflow-y-auto">
        <div className="sticky top-0 bg-canvas border-b-3 border-black px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
              Historique
            </p>
            <h3 className="font-black uppercase tracking-tight">
              {conversations.length} brief{conversations.length > 1 ? "s" : ""}
            </h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-lf-yellow border-3 border-black">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 flex flex-col gap-2">
          {conversations.length === 0 && (
            <p className="text-sm font-medium text-lf-gray text-center py-8">
              Aucun brief pour l'instant.
            </p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c.id)}
              className={`text-left p-3 border-3 border-black transition-all ${
                c.id === activeId
                  ? "bg-lf-black text-white"
                  : "bg-white hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000]"
              }`}
            >
              <p className="font-black text-sm line-clamp-2">{c.title}</p>
              <p
                className={`text-[10px] uppercase tracking-wider mt-1 ${
                  c.id === activeId ? "text-white/60" : "text-lf-gray"
                }`}
              >
                {new Date(c.updated_at).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
