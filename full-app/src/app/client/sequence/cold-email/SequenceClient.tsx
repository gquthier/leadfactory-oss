"use client";

import { useState, useEffect, useRef, useCallback, forwardRef } from "react";
import {
  Mail,
  Send,
  Sparkles,
  Loader2,
  Bot,
  User,
  Plus,
  MessageSquare,
  Trash2,
  ChevronRight,
  Info,
  Clock,
  Edit3,
  X,
  Check,
  Copy,
  PanelLeftClose,
  PanelLeftOpen,
  GripVertical,
  FileDown,
  Braces,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

// ── Types côté client ────────────────────────────────────────────────────────

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

interface SequenceEmail {
  id: string;
  conversation_id: string;
  order_index: number;
  subject: string | null;
  body: string;
  wait_days: number;
  status: "draft" | "scheduled" | "sent" | "action_needed";
  ab_variants: unknown[];
}

interface Props {
  initialConversations: ConversationSummary[];
  contextSummary: Array<{ label: string; value: string }>;
  hasOnboarding: boolean;
  firstName: string;
}

const SUGGESTIONS = [
  "Génère-moi une séquence outbound de 4 emails pour mes prospects",
  "Propose-moi 3 angles différents pour ouvrir une séquence",
  "Réécris le 1er email avec un ton plus direct",
  "Ajoute un email de relance avec une question simple",
  "Donne-moi un subject line ultra court qui intrigue",
];

// ── Resizable timeline ────────────────────────────────────────────────────────
const TIMELINE_MIN = 320;
const TIMELINE_MAX = 720;
const TIMELINE_DEFAULT = 420;
const TIMELINE_STORAGE_KEY = "lf-sequence-timeline-width";
const SIDEBAR_STORAGE_KEY = "lf-sequence-sidebar-collapsed";

// ─────────────────────────────────────────────────────────────────────────────

export function SequenceClient({
  initialConversations,
  contextSummary,
  hasOnboarding,
  firstName,
}: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [emails, setEmails] = useState<SequenceEmail[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [timelineWidth, setTimelineWidth] = useState<number>(TIMELINE_DEFAULT);
  const [provider, setProvider] = useState<SequenceProvider>("none");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // ── Hydratation localStorage (sidebar + timeline width) ───────────────────
  useEffect(() => {
    const w = localStorage.getItem(TIMELINE_STORAGE_KEY);
    if (w) {
      const parsed = parseInt(w, 10);
      if (!isNaN(parsed) && parsed >= TIMELINE_MIN && parsed <= TIMELINE_MAX) {
        setTimelineWidth(parsed);
      }
    }
    const s = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (s === "1") setSidebarCollapsed(true);
    const p = localStorage.getItem(PROVIDER_STORAGE_KEY) as SequenceProvider | null;
    if (p) setProvider(p);
  }, []);

  const updateProvider = useCallback((next: SequenceProvider) => {
    setProvider(next);
    localStorage.setItem(PROVIDER_STORAGE_KEY, next);
  }, []);

  // ── Drag handle pour resize de la timeline ─────────────────────────────────
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = timelineRef.current?.offsetWidth ?? timelineWidth;
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    [timelineWidth]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const maxByViewport = Math.min(TIMELINE_MAX, Math.floor(window.innerWidth * 0.6));
      // delta inversé : on tire vers la gauche pour AGRANDIR la timeline
      const delta = resizeStartX.current - e.clientX;
      const next = Math.max(
        TIMELINE_MIN,
        Math.min(maxByViewport, resizeStartWidth.current + delta)
      );
      setTimelineWidth(next);
    };
    const onUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (timelineRef.current) {
        localStorage.setItem(
          TIMELINE_STORAGE_KEY,
          String(timelineRef.current.offsetWidth)
        );
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  // ── Effects ────────────────────────────────────────────────────────────────

  // Auto-scroll au bas du chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Focus input à l'ouverture
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Charge la conversation la plus récente au montage
  useEffect(() => {
    if (initialConversations.length > 0 && !activeConversationId) {
      loadConversation(initialConversations[0].id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────────────────────

  const loadConversation = useCallback(async (id: string) => {
    setLoadingConv(true);
    try {
      const res = await fetch(`/api/client/sequence/conversations/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur chargement");
      setActiveConversationId(id);
      setMessages(data.conversation?.messages ?? []);
      setEmails(data.emails ?? []);
    } catch (e) {
      console.error("loadConversation:", e);
    } finally {
      setLoadingConv(false);
    }
  }, []);

  const newConversation = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setEmails([]);
    inputRef.current?.focus();
  }, []);

  const deleteConv = useCallback(
    async (id: string) => {
      if (!confirm("Supprimer cette séquence et tous ses emails ?")) return;
      const res = await fetch(`/api/client/sequence/conversations/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (id === activeConversationId) {
          newConversation();
        }
      }
    },
    [activeConversationId, newConversation]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      // Ajout optimiste user
      const userMsg: ChatMessage = {
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);

      try {
        const res = await fetch("/api/client/sequence/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            conversation_id: activeConversationId,
            provider,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur IA");

        // Réponse + emails
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response || "",
            timestamp: new Date().toISOString(),
          },
        ]);

        if (Array.isArray(data.emails) && data.emails.length > 0) {
          setEmails(data.emails);
        }

        // Nouvelle conversation créée côté serveur
        if (!activeConversationId && data.conversation_id) {
          setActiveConversationId(data.conversation_id);
          // Refresh la liste des conversations
          const listRes = await fetch("/api/client/sequence/conversations");
          if (listRes.ok) {
            const listData = await listRes.json();
            setConversations(listData.conversations ?? []);
          }
        } else if (activeConversationId) {
          // Met à jour le updated_at dans la liste
          setConversations((prev) => {
            const updated = prev.map((c) =>
              c.id === activeConversationId
                ? { ...c, updated_at: new Date().toISOString() }
                : c
            );
            return [...updated].sort((a, b) =>
              b.updated_at.localeCompare(a.updated_at)
            );
          });
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Erreur inconnue";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `❌ ${errMsg}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [activeConversationId, sending, provider]
  );

  const updateEmail = useCallback(
    async (id: string, patch: Partial<SequenceEmail>) => {
      // Optimistic
      setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
      const res = await fetch(`/api/client/sequence/emails/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        // Revert : recharger la conversation
        if (activeConversationId) await loadConversation(activeConversationId);
      }
    },
    [activeConversationId, loadConversation]
  );

  const deleteEmailRow = useCallback(
    async (id: string) => {
      if (!confirm("Supprimer cet email de la séquence ?")) return;
      setEmails((prev) => prev.filter((e) => e.id !== id));
      await fetch(`/api/client/sequence/emails/${id}`, { method: "DELETE" });
    },
    []
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };


  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-canvas">
      {/* ─── Header (hauteur 73px pour aligner avec la sidebar globale) ──── */}
      <div className="flex-shrink-0 border-b-3 border-black bg-white">
        <div className="flex items-center justify-between gap-3 px-6 h-[73px]">
          <div className="flex items-center gap-3 min-w-0">
            {/* Toggle main sidebar — émet un event écouté par ClientLayoutClient */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("lf-toggle-main-sidebar"))}
              className="hidden lg:flex items-center justify-center w-10 h-10 bg-white text-lf-black border-3 border-black hover:bg-lf-yellow hover:shadow-[3px_3px_0_#000] transition-all flex-shrink-0"
              title="Réduire / déplier le menu principal"
              aria-label="Toggle menu principal"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
            <div className="w-10 h-10 bg-lf-yellow border-3 border-black flex items-center justify-center flex-shrink-0">
              <Mail className="w-5 h-5 text-black" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black uppercase tracking-tight leading-none">
                Outbound IA
              </h1>
              <p className="text-xs text-lf-gray font-medium mt-1">
                Chat Your Sequence · génère des séquences emails personnalisées
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Toggle sidebar (desktop only) */}
            <button
              onClick={toggleSidebar}
              className="hidden lg:flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase border-3 border-black bg-white hover:bg-lf-yellow/40 transition-all"
              title={sidebarCollapsed ? "Afficher l'historique" : "Masquer l'historique"}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-3.5 h-3.5" />
              ) : (
                <PanelLeftClose className="w-3.5 h-3.5" />
              )}
            </button>
            <VariablesButton selected={provider} onChange={updateProvider} />
            <button
              onClick={() => setShowContext((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase border-3 border-black transition-all ${
                showContext ? "bg-lf-yellow" : "bg-white hover:bg-lf-yellow/40"
              }`}
            >
              <Info className="w-3.5 h-3.5" />
              Contexte
            </button>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`lg:hidden flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase border-3 border-black transition-all ${
                showHistory ? "bg-lf-yellow" : "bg-white"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Historique
            </button>
            <button
              onClick={newConversation}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase bg-lf-black text-white border-3 border-black hover:bg-lf-blue transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Nouvelle séquence
            </button>
          </div>
        </div>

        {/* Bandeau onboarding manquant */}
        {!hasOnboarding && (
          <div className="px-6 py-2.5 bg-lf-yellow border-t-2 border-black flex items-center gap-2">
            <Info className="w-4 h-4 flex-shrink-0" />
            <p className="text-xs font-black uppercase">
              Ton onboarding n'est pas encore rempli — l'IA travaillera avec un contexte limité. Complète-le depuis l'espace partenaire pour des emails ultra-personnalisés.
            </p>
          </div>
        )}

        {/* Drawer contexte */}
        {showContext && (
          <ContextDrawer summary={contextSummary} onClose={() => setShowContext(false)} />
        )}
      </div>

      {/* ─── Body : sidebar + chat + timeline ────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar conversations (desktop) */}
        <ConversationSidebar
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={loadConversation}
          onDelete={deleteConv}
          onNew={newConversation}
          mobileOpen={showHistory}
          onMobileClose={() => setShowHistory(false)}
          collapsedDesktop={sidebarCollapsed}
        />

        {/* Chat central */}
        <div className="flex-1 flex flex-col min-w-0 bg-canvas">
          <ChatArea
            messages={messages}
            sending={sending}
            loadingConv={loadingConv}
            firstName={firstName}
            messagesEndRef={messagesEndRef}
            onSuggestionClick={sendMessage}
          />

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex-shrink-0 p-4 border-t-3 border-black bg-white"
          >
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Décris ce que tu veux pour ta séquence outbound..."
                disabled={sending}
                rows={1}
                className="flex-1 min-w-0 px-4 py-3 border-3 border-black font-medium text-sm focus:outline-none focus:border-lf-blue bg-canvas disabled:opacity-60 transition-colors resize-none"
                style={{
                  minHeight: "48px",
                  maxHeight: "160px",
                }}
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="px-4 py-3 bg-lf-black text-white border-3 border-black font-black disabled:opacity-40 hover:bg-lf-blue transition-colors flex-shrink-0 h-12"
                aria-label="Envoyer"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-lf-gray font-medium mt-2 text-center">
              Outbound IA · contexte tiré de ton onboarding
            </p>
          </form>
        </div>

        {/* Timeline emails (desktop) — resizable */}
        {emails.length > 0 && (
          <SequenceTimeline
            ref={timelineRef}
            emails={emails}
            width={timelineWidth}
            onResizeStart={onResizeStart}
            onUpdate={updateEmail}
            onDelete={deleteEmailRow}
            clientFirstName={firstName}
          />
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Sous-composants
// ═════════════════════════════════════════════════════════════════════════════

function ContextDrawer({
  summary,
  onClose,
}: {
  summary: Array<{ label: string; value: string }>;
  onClose: () => void;
}) {
  return (
    <div className="px-6 py-4 bg-white border-t-3 border-black">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-black uppercase tracking-wider text-lf-gray">
          Contexte client utilisé par l'IA
        </p>
        <button onClick={onClose} className="text-lf-gray hover:text-black">
          <X className="w-4 h-4" />
        </button>
      </div>
      {summary.length === 0 ? (
        <p className="text-sm text-lf-gray font-medium">
          Aucun contexte trouvé. Complète ton onboarding pour des séquences personnalisées.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {summary.map((item) => (
            <div
              key={item.label}
              className="border-2 border-black bg-canvas p-3"
            >
              <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
                {item.label}
              </p>
              <p className="text-sm font-medium line-clamp-3 leading-snug">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNew,
  mobileOpen,
  onMobileClose,
  collapsedDesktop,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  collapsedDesktop: boolean;
}) {
  const desktopClasses = collapsedDesktop
    ? "hidden"
    : "hidden lg:flex lg:w-64 lg:flex-shrink-0 flex-col border-r-3 border-black bg-white";
  const mobileClasses = mobileOpen
    ? "fixed inset-y-0 left-0 z-40 w-72 flex flex-col border-r-3 border-black bg-white lg:hidden"
    : "hidden";

  const Content = (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b-3 border-black bg-canvas">
        <p className="text-xs font-black uppercase tracking-wider">Mes séquences</p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              onNew();
              onMobileClose();
            }}
            className="p-1.5 hover:bg-lf-yellow border-2 border-transparent hover:border-black transition-all"
            title="Nouvelle séquence"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onMobileClose}
            className="lg:hidden p-1.5 hover:bg-lf-yellow border-2 border-transparent hover:border-black transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {conversations.length === 0 && (
          <p className="text-xs text-lf-gray font-medium text-center p-4">
            Aucune séquence encore.<br />
            Pose ta 1re question →
          </p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center justify-between gap-2 px-3 py-2.5 border-3 cursor-pointer transition-all ${
              c.id === activeId
                ? "border-black bg-lf-yellow shadow-[3px_3px_0px_#000]"
                : "border-transparent hover:border-black hover:bg-lf-yellow/30"
            }`}
            onClick={() => {
              onSelect(c.id);
              onMobileClose();
            }}
          >
            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
            <p className="flex-1 text-xs font-bold truncate">{c.title}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-lf-gray hover:text-red-500 transition-opacity flex-shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <>
      <div className={desktopClasses}>{Content}</div>
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={onMobileClose}
          />
          <div className={mobileClasses}>{Content}</div>
        </>
      )}
    </>
  );
}

function ChatArea({
  messages,
  sending,
  loadingConv,
  firstName,
  messagesEndRef,
  onSuggestionClick,
}: {
  messages: ChatMessage[];
  sending: boolean;
  loadingConv: boolean;
  firstName: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onSuggestionClick: (text: string) => void;
}) {
  if (loadingConv) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Loader2 className="w-6 h-6 animate-spin text-lf-blue" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-6 flex flex-col gap-4 min-h-0">
      {/* Empty state */}
      {messages.length === 0 && (
        <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full pt-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-lf-yellow border-3 border-black flex items-center justify-center mx-auto mb-3 shadow-[4px_4px_0px_#000]">
              <Sparkles className="w-8 h-8 text-black" />
            </div>
            <p className="text-2xl font-black uppercase tracking-tight">
              Salut {firstName} 👋
            </p>
            <p className="text-sm text-lf-gray font-medium mt-2 leading-relaxed max-w-md mx-auto">
              Je suis ton copywriter outbound. Dis-moi ce que tu veux et je te génère des séquences emails ciblées, basées sur ton offre et ta cible.
            </p>
          </div>

          <p className="text-xs font-black uppercase tracking-wider text-lf-gray mt-4">
            Pour démarrer
          </p>
          <div className="flex flex-col gap-2">
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => onSuggestionClick(q)}
                className="flex items-center justify-between text-left text-sm font-medium px-4 py-3 border-3 border-black bg-white hover:bg-lf-yellow hover:shadow-[3px_3px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] transition-all"
              >
                <span>{q}</span>
                <ChevronRight className="w-4 h-4 flex-shrink-0 ml-2 opacity-40" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      {messages.map((msg, i) => (
        <ChatBubble key={i} message={msg} />
      ))}

      {sending && (
        <div className="flex gap-3">
          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center border-3 border-black bg-lf-yellow">
            <Bot className="w-4 h-4 text-black" />
          </div>
          <div className="flex-1 border-3 border-black p-3 bg-white flex items-center gap-2 max-w-xl">
            <Loader2 className="w-4 h-4 animate-spin text-lf-blue flex-shrink-0" />
            <span className="text-sm text-lf-gray font-medium">Rédaction en cours...</span>
          </div>
        </div>
      )}

      <div ref={messagesEndRef as React.RefObject<HTMLDivElement>} />
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-8 h-8 flex-shrink-0 flex items-center justify-center border-3 border-black ${
          isUser ? "bg-lf-blue" : "bg-lf-yellow"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-4 h-4 text-black" />
        )}
      </div>
      <div
        className={`flex-1 min-w-0 max-w-2xl text-sm font-medium leading-relaxed border-3 border-black p-3 break-words ${
          isUser ? "bg-lf-blue text-white whitespace-pre-wrap" : "bg-white text-lf-black"
        }`}
      >
        {isUser ? (
          message.content
        ) : message.content.trim().length === 0 ? (
          <span className="text-lf-gray italic">
            (Séquence générée — voir la timeline à droite →)
          </span>
        ) : (
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h1 className="text-base font-black uppercase tracking-wide mb-2 mt-1">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-sm font-black uppercase tracking-wide mb-1.5 mt-2 first:mt-0">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-black mb-1 mt-2 first:mt-0">{children}</h3>
              ),
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-black">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              ul: ({ children }) => (
                <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>
              ),
              code: ({ children }) => (
                <code className="bg-gray-100 border border-gray-300 px-1 py-0.5 text-xs font-mono rounded-none">
                  {children}
                </code>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline emails — édition inline, suppression, statut, A/B, resize, export
// ─────────────────────────────────────────────────────────────────────────────

const SequenceTimeline = forwardRef<
  HTMLDivElement,
  {
    emails: SequenceEmail[];
    width: number;
    onResizeStart: (e: React.MouseEvent) => void;
    onUpdate: (id: string, patch: Partial<SequenceEmail>) => void;
    onDelete: (id: string) => void;
    clientFirstName: string;
  }
>(function SequenceTimeline(
  { emails, width, onResizeStart, onUpdate, onDelete, clientFirstName },
  ref
) {
  return (
    <div
      ref={ref}
      className="hidden lg:flex flex-shrink-0 flex-col border-l-3 border-black bg-white relative"
      style={{ width: `${width}px` }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={onResizeStart}
        className="absolute left-0 top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-ew-resize z-10 group hover:bg-lf-yellow/40 transition-colors"
        title="Glisser pour redimensionner"
      >
        <GripVertical className="w-3 h-4 text-black/20 group-hover:text-black/60 transition-colors" />
      </div>

      <div className="flex-shrink-0 px-4 py-3 border-b-3 border-black bg-canvas flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wider">Séquence emails</p>
          <p className="text-[10px] text-lf-gray font-medium mt-0.5">
            {emails.length} email{emails.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => copySequenceToClipboard(emails)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-black uppercase bg-white border-2 border-black hover:bg-lf-yellow transition-colors"
            title="Copier la séquence"
          >
            <Copy className="w-3 h-3" />
            Copier
          </button>
          <button
            onClick={() => downloadSequencePdf(emails, clientFirstName)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-black uppercase bg-lf-yellow border-2 border-black hover:bg-white transition-colors"
            title="Télécharger en PDF"
          >
            <FileDown className="w-3 h-3" />
            PDF
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {emails.map((email, idx) => (
          <EmailCard
            key={email.id}
            email={email}
            index={idx}
            onUpdate={(patch) => onUpdate(email.id, patch)}
            onDelete={() => onDelete(email.id)}
          />
        ))}
      </div>
    </div>
  );
});

function EmailCard({
  email,
  index,
  onUpdate,
  onDelete,
}: {
  email: SequenceEmail;
  index: number;
  onUpdate: (patch: Partial<SequenceEmail>) => void;
  onDelete: () => void;
}) {
  const [editingSubject, setEditingSubject] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState(email.subject ?? "");
  const [bodyDraft, setBodyDraft] = useState(email.body);

  useEffect(() => setSubjectDraft(email.subject ?? ""), [email.subject]);
  useEffect(() => setBodyDraft(email.body), [email.body]);

  const saveSubject = () => {
    onUpdate({ subject: subjectDraft });
    setEditingSubject(false);
  };
  const saveBody = () => {
    onUpdate({ body: bodyDraft });
    setEditingBody(false);
  };

  return (
    <div className="border-3 border-black bg-white shadow-[3px_3px_0px_#000]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-lf-black text-white">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 bg-lf-yellow text-black border-2 border-white/30 flex items-center justify-center text-xs font-black flex-shrink-0">
            {index + 1}
          </span>
          <span className="text-xs font-black uppercase tracking-wider truncate">
            Email {index + 1}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Wait days */}
          <div className="flex items-center gap-1 text-xs font-bold">
            <Clock className="w-3 h-3" />
            <input
              type="number"
              min={0}
              value={email.wait_days}
              onChange={(e) =>
                onUpdate({ wait_days: Math.max(0, parseInt(e.target.value || "0", 10)) })
              }
              className="w-10 bg-transparent border border-white/30 text-white text-xs text-center font-bold focus:outline-none focus:border-lf-yellow"
            />
            <span className="text-white/60">j</span>
          </div>
          <button
            onClick={onDelete}
            className="text-white/50 hover:text-red-400 transition-colors"
            title="Supprimer cet email"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Subject */}
      <div className="border-b-2 border-black px-3 py-2 bg-canvas">
        <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
          Subject
        </p>
        {editingSubject ? (
          <div className="flex gap-1">
            <input
              autoFocus
              value={subjectDraft}
              onChange={(e) => setSubjectDraft(e.target.value)}
              onBlur={saveSubject}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveSubject();
                if (e.key === "Escape") {
                  setSubjectDraft(email.subject ?? "");
                  setEditingSubject(false);
                }
              }}
              className="flex-1 px-2 py-1 text-sm font-bold border-2 border-black bg-white focus:outline-none focus:border-lf-blue"
            />
            <button
              onClick={saveSubject}
              className="px-2 bg-lf-green text-white border-2 border-black"
            >
              <Check className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditingSubject(true)}
            className="text-left w-full group flex items-start gap-1 hover:bg-white/50 -mx-1 px-1 py-0.5 transition-colors"
          >
            <p className="flex-1 text-sm font-bold leading-snug">
              {email.subject || (
                <span className="text-lf-gray italic font-medium">
                  (Pas de subject — clique pour ajouter)
                </span>
              )}
            </p>
            <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-60 mt-1 flex-shrink-0" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
          Body
        </p>
        {editingBody ? (
          <div className="flex flex-col gap-1">
            <textarea
              autoFocus
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setBodyDraft(email.body);
                  setEditingBody(false);
                }
              }}
              rows={Math.max(6, bodyDraft.split("\n").length + 1)}
              className="w-full px-2 py-2 text-sm font-medium border-2 border-black bg-white focus:outline-none focus:border-lf-blue resize-y leading-relaxed"
            />
            <div className="flex gap-1 justify-end">
              <button
                onClick={() => {
                  setBodyDraft(email.body);
                  setEditingBody(false);
                }}
                className="px-2 py-1 text-xs font-black uppercase bg-white border-2 border-black"
              >
                Annuler
              </button>
              <button
                onClick={saveBody}
                className="px-2 py-1 text-xs font-black uppercase bg-lf-green text-white border-2 border-black"
              >
                Enregistrer
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditingBody(true)}
            className="text-left w-full group hover:bg-canvas/50 -mx-1 px-1 py-0.5 transition-colors"
          >
            <pre className="text-xs font-medium leading-relaxed whitespace-pre-wrap font-sans">
              {email.body}
            </pre>
            <div className="flex items-center gap-1 mt-1 text-[10px] font-bold text-lf-gray opacity-0 group-hover:opacity-100 transition-opacity">
              <Edit3 className="w-2.5 h-2.5" />
              Cliquer pour éditer
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

function copySequenceToClipboard(emails: SequenceEmail[]) {
  const text = emails
    .map((e, i) => {
      const header = `═══ EMAIL ${i + 1}${e.wait_days > 0 ? ` (J+${e.wait_days})` : " (J+0)"} ═══`;
      const subject = e.subject ? `Subject: ${e.subject}\n` : "";
      return `${header}\n${subject}\n${e.body}\n`;
    })
    .join("\n");

  navigator.clipboard.writeText(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Export PDF — branded LeadFactory (yellow/black brutalist)
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function downloadSequencePdf(emails: SequenceEmail[], firstName: string) {
  // html2pdf.js est déjà dans les deps de leadfactory-app
  // Import dynamique pour éviter de charger côté SSR / build
  const html2pdf = (await import("html2pdf.js")).default;

  const dateStr = new Date().toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const emailsHtml = emails
    .map((e, i) => {
      const dayLabel = e.wait_days > 0 ? `J+${e.wait_days}` : "J+0 — Email d'ouverture";
      return `
        <div class="email-card">
          <div class="email-header">
            <span class="email-num">${i + 1}</span>
            <span class="email-label">Email ${i + 1}</span>
            <span class="email-day">${dayLabel}</span>
          </div>
          <div class="email-subject-block">
            <div class="field-label">Subject</div>
            <div class="email-subject">${escapeHtml(e.subject ?? "(sans sujet)")}</div>
          </div>
          <div class="email-body-block">
            <div class="field-label">Body</div>
            <pre class="email-body">${escapeHtml(e.body)}</pre>
          </div>
        </div>
      `;
    })
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700;900&display=swap');

        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 0;
          font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
          background: #FFF9E5;
          color: #0A0A0A;
        }
        .page {
          padding: 40px 36px;
          min-height: 100vh;
        }
        .cover {
          border: 4px solid #0A0A0A;
          background: #FFE94D;
          padding: 32px 28px;
          margin-bottom: 28px;
          box-shadow: 8px 8px 0 #0A0A0A;
        }
        .brand {
          display: inline-block;
          background: #0A0A0A;
          color: #FFE94D;
          padding: 6px 12px;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 18px;
        }
        h1 {
          font-size: 38px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: -0.02em;
          margin: 0 0 8px 0;
          line-height: 1;
        }
        .subtitle {
          font-size: 14px;
          font-weight: 500;
          color: #0A0A0A;
          opacity: 0.7;
          margin: 0;
        }
        .meta {
          display: flex;
          gap: 16px;
          margin-top: 18px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .meta span {
          padding: 4px 10px;
          border: 2px solid #0A0A0A;
          background: #FFF9E5;
        }

        .email-card {
          background: #FFFFFF;
          border: 4px solid #0A0A0A;
          margin-bottom: 24px;
          box-shadow: 6px 6px 0 #0A0A0A;
          page-break-inside: avoid;
        }
        .email-header {
          background: #0A0A0A;
          color: #FFFFFF;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .email-num {
          width: 28px;
          height: 28px;
          background: #FFE94D;
          color: #0A0A0A;
          font-weight: 900;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid rgba(255,255,255,0.3);
        }
        .email-label {
          font-weight: 900;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .email-day {
          margin-left: auto;
          font-weight: 700;
          font-size: 11px;
          color: #FFE94D;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .email-subject-block, .email-body-block {
          padding: 14px 16px;
        }
        .email-subject-block {
          background: #FFF9E5;
          border-bottom: 3px solid #0A0A0A;
        }
        .field-label {
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #6B6B6B;
          margin-bottom: 4px;
        }
        .email-subject {
          font-size: 15px;
          font-weight: 700;
          color: #0A0A0A;
          line-height: 1.3;
        }
        .email-body {
          font-family: 'Space Grotesk', system-ui, sans-serif;
          font-size: 12px;
          font-weight: 400;
          color: #0A0A0A;
          white-space: pre-wrap;
          word-wrap: break-word;
          line-height: 1.55;
          margin: 0;
        }

        .footer {
          margin-top: 32px;
          padding-top: 18px;
          border-top: 2px solid #0A0A0A;
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #6B6B6B;
        }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="cover">
          <div class="brand">⚡ LeadFactory · Outbound IA</div>
          <h1>Ta séquence outbound</h1>
          <p class="subtitle">${emails.length} email${emails.length > 1 ? "s" : ""} prêt${emails.length > 1 ? "s" : ""} à être envoyé${emails.length > 1 ? "s" : ""}</p>
          <div class="meta">
            <span>Client · ${escapeHtml(firstName)}</span>
            <span>Généré le ${dateStr}</span>
          </div>
        </div>

        ${emailsHtml}

        <div class="footer">
          <span>LeadFactory · Chat Your Sequence</span>
          <span>Page <span class="pageNumber"></span></span>
        </div>
      </div>
    </body>
    </html>
  `;

  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    await html2pdf()
      .set({
        margin: 0,
        filename: `leadfactory-sequence-${new Date().toISOString().slice(0, 10)}.pdf`,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#FFF9E5" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(container)
      .save();
  } finally {
    document.body.removeChild(container);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VariablesButton — sélecteur d'outil de prospection
//
// L'utilisateur sélectionne SON outil d'envoi (Emelia, Lemlist, Smartlead…).
// L'IA injecte ensuite les merge tags au BON format dans les emails générés,
// pour que le copier-coller dans l'outil soit direct (pas de renommage).
// ─────────────────────────────────────────────────────────────────────────────

import { PROVIDER_LIST, type SequenceProvider } from "@/lib/sequence-providers";

const PROVIDER_STORAGE_KEY = "lf-sequence-provider";

function VariablesButton({
  selected,
  onChange,
}: {
  selected: SequenceProvider;
  onChange: (provider: SequenceProvider) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = PROVIDER_LIST.find((p) => p.id === selected) ?? PROVIDER_LIST[PROVIDER_LIST.length - 1];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase border-3 border-black transition-all ${
          open
            ? "bg-lf-yellow"
            : selected !== "none"
            ? "bg-lf-yellow/60 hover:bg-lf-yellow"
            : "bg-white hover:bg-lf-yellow/40"
        }`}
        title={`Outil de prospection : ${current.label}`}
      >
        <Braces className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{selected === "none" ? "Outil" : current.label}</span>
        <span className="sm:hidden">Outil</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-[380px] max-h-[500px] bg-white border-3 border-black shadow-[6px_6px_0_#000] z-50 flex flex-col">
          <div className="flex-shrink-0 p-3 border-b-3 border-black bg-canvas">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-black uppercase tracking-wider">
                Adapte les variables à ton outil
              </p>
              <button
                onClick={() => setOpen(false)}
                className="text-lf-gray hover:text-black"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[10px] font-medium text-lf-gray leading-snug">
              L'IA va générer les emails avec les merge tags exacts de l'outil sélectionné — copier-coller direct, pas de renommage.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
            {PROVIDER_LIST.map((p) => {
              const isSelected = p.id === selected;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className={`text-left px-3 py-2.5 border-3 transition-all ${
                    isSelected
                      ? "border-black bg-lf-yellow shadow-[3px_3px_0_#000]"
                      : "border-transparent hover:border-black hover:bg-lf-yellow/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="font-black text-sm uppercase tracking-tight">
                      {p.label}
                    </p>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-[10px] text-lf-gray font-medium mb-1">{p.description}</p>
                  {p.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.tags.slice(0, 4).map((t) => (
                        <code
                          key={t.token}
                          className="text-[9px] font-mono font-bold text-lf-blue bg-white border border-black/20 px-1 py-0.5"
                        >
                          {t.token}
                        </code>
                      ))}
                      {p.tags.length > 4 && (
                        <span className="text-[9px] font-bold text-lf-gray">
                          +{p.tags.length - 4} autres
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
