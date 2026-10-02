"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Film,
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
  PanelLeftOpen,
  Hash,
  Clock,
  Instagram,
  GripVertical,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

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

interface GeneratedScript {
  id: string;
  body: string;
  hook: string | null;
  framework: string | null;
  format: "reel" | "tiktok" | "short";
  platform: "instagram" | "tiktok" | "youtube";
  duration_seconds: number | null;
  metrics: { length?: number };
}

interface Props {
  initialConversations: ConversationSummary[];
  initialActiveConversationId: string | null;
  initialMessages: ChatMessage[];
  initialScripts: GeneratedScript[];
  contextSummary: Array<{ label: string; value: string }>;
  hasOnboarding: boolean;
  firstName: string;
}

const SCRIPTS_PANE_MIN = 340;
const SCRIPTS_PANE_MAX = 820;
const SCRIPTS_PANE_DEFAULT = 460;
const SCRIPTS_PANE_STORAGE_KEY = "lf-reels-scripts-width";

const SUGGESTIONS = [
  "Génère 3 Reels qui parlent du pain point #1 de mon ICP — un Contrarian, un Storytime, un Listicle",
  "Écris un Reel HALA de 60s avec un hook 'Result-First' qui prouve mon expertise",
  "Propose 2 scripts Before/After basés sur un de mes meilleurs cas client",
  "Donne-moi 5 hooks différents pour un Reel sur [TON SUJET ICI] — je choisirai le meilleur",
  "Script de Reel format Native Q&A : 'la question qu'on me pose tout le temps en DM'",
  "Reel TrendHijack 45s : je veux surfer sur [TREND DU MOMENT] sans perdre mon ton pro",
];

function stripScriptBlocksFromText(text: string): string {
  return text.replace(/<reel-script[^>]*>[\s\S]*?<\/reel-script>/gi, "").trim();
}

const PLATFORM_ICON: Record<GeneratedScript["platform"], typeof Instagram> = {
  instagram: Instagram,
  tiktok: Film,
  youtube: Film,
};

const PLATFORM_LABEL: Record<GeneratedScript["platform"], string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
};

export function ReelsGeneratorClient({
  initialConversations,
  initialActiveConversationId,
  initialMessages,
  initialScripts,
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
  const [scripts, setScripts] = useState<GeneratedScript[]>(initialScripts);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [scriptsWidth, setScriptsWidth] = useState<number>(SCRIPTS_PANE_DEFAULT);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scriptsRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // ── Hydrate la largeur depuis localStorage ────────────────────────
  useEffect(() => {
    const w = localStorage.getItem(SCRIPTS_PANE_STORAGE_KEY);
    if (w) {
      const parsed = parseInt(w, 10);
      if (!isNaN(parsed) && parsed >= SCRIPTS_PANE_MIN && parsed <= SCRIPTS_PANE_MAX) {
        setScriptsWidth(parsed);
      }
    }
  }, []);

  // ── Drag handle pour resize du pane scripts ───────────────────────
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = scriptsRef.current?.offsetWidth ?? scriptsWidth;
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    [scriptsWidth]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const maxByViewport = Math.min(SCRIPTS_PANE_MAX, Math.floor(window.innerWidth * 0.65));
      // delta inversé : on tire vers la gauche pour AGRANDIR le pane droit
      const delta = resizeStartX.current - e.clientX;
      const next = Math.max(
        SCRIPTS_PANE_MIN,
        Math.min(maxByViewport, resizeStartWidth.current + delta)
      );
      setScriptsWidth(next);
    };
    const onUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (scriptsRef.current) {
        localStorage.setItem(
          SCRIPTS_PANE_STORAGE_KEY,
          String(scriptsRef.current.offsetWidth)
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

  const loadConversation = useCallback(async (id: string) => {
    setActiveConversationId(id);
    setShowHistory(false);
    try {
      const r = await fetch(
        `/api/client/personal-brand/reels/conversation?id=${id}`,
        { cache: "no-store" }
      );
      if (!r.ok) return;
      const data = (await r.json()) as {
        messages: ChatMessage[];
        scripts: GeneratedScript[];
      };
      setMessages(data.messages ?? []);
      setScripts(data.scripts ?? []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const newConversation = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setScripts([]);
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
      const r = await fetch("/api/client/personal-brand/reels/chat", {
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
        scripts: GeneratedScript[];
      };

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
      if (data.scripts && data.scripts.length > 0) setScripts(data.scripts);
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

  const isEmpty = messages.length === 0 && !sending;

  return (
    <div className="flex flex-col h-full bg-canvas">
      {/* HEADER */}
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

          <div className="w-10 h-10 bg-lf-pink border-3 border-black rounded-xl flex items-center justify-center flex-shrink-0">
            <Film className="w-5 h-5 text-black" />
          </div>

          <div className="min-w-0">
            <h1 className="text-base lg:text-lg font-black uppercase tracking-tight leading-none">
              Générateur Reels
            </h1>
            <p className="text-[10px] lg:text-xs font-black uppercase tracking-wider text-lf-gray mt-1">
              Personal Brand IA · Reel Doctor
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
            className="flex items-center gap-2 px-3 py-2 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-pink hover:text-black hover:shadow-[3px_3px_0_#000] transition-all"
            title="Nouveau brief"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouveau</span>
          </button>
        </div>
      </div>

      {/* BODY 2-pane */}
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
                    <div className="w-8 h-8 bg-lf-pink border-3 border-black rounded-full flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="bg-white border-3 border-black p-4 inline-flex items-center gap-2 shadow-brutal-xs">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm font-medium">Reel Doctor rédige…</span>
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
                  placeholder="Brief Reel Doctor : sujet, framework, durée souhaitée…"
                  rows={2}
                  className="flex-1 px-3 py-2 border-3 border-black font-medium text-sm resize-none focus:outline-none focus:bg-lf-pink/10"
                  disabled={sending}
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || !input.trim()}
                  className="flex items-center gap-2 px-4 py-3 bg-lf-black text-white border-3 border-black font-black text-xs uppercase tracking-wider hover:bg-lf-pink hover:text-black hover:shadow-[3px_3px_0_#000] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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

        {/* SCRIPTS pane (resizable) */}
        <div
          ref={scriptsRef}
          className="hidden lg:flex flex-col flex-shrink-0 bg-canvas relative"
          style={{ width: `${scriptsWidth}px` }}
        >
          {/* Drag handle gauche */}
          <div
            onMouseDown={onResizeStart}
            className="absolute left-0 top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-ew-resize z-10 group hover:bg-lf-pink/40 transition-colors"
            title="Glisser pour redimensionner"
          >
            <GripVertical className="w-3 h-4 text-black/20 group-hover:text-black/60 transition-colors" />
          </div>

          {scripts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-6 text-center">
              <div className="w-12 h-12 bg-lf-pink border-3 border-black rounded-xl flex items-center justify-center mb-3">
                <Sparkles className="w-6 h-6" />
              </div>
              <p className="font-black uppercase text-sm tracking-tight">
                Scripts générés
              </p>
              <p className="text-xs font-medium text-lf-gray mt-2 max-w-[260px]">
                Ils apparaissent ici dès que Reel Doctor les rédige. Hook, body et CTA prêts à tourner — avec les visual cues pour le montage.
              </p>
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider">
                  {scripts.length} script{scripts.length > 1 ? "s" : ""} généré{scripts.length > 1 ? "s" : ""}
                </span>
              </div>
              {scripts.map((s, i) => (
                <ScriptCard
                  key={s.id}
                  index={i + 1}
                  script={s}
                  copied={copiedId === s.id}
                  onCopy={() => void copyToClipboard(s.id, s.body)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* DRAWERS */}
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
      <div className="sticker -rotate-1 inline-block mb-4">REEL DOCTOR</div>
      <h2 className="text-2xl lg:text-3xl font-black uppercase tracking-tight mb-3">
        Salut {firstName}, on tourne quoi aujourd&apos;hui ?
      </h2>
      <p className="text-lf-gray font-medium mb-6">
        Reel Doctor connaît ton offre, ta promesse et ton ICP (via ton onboarding).
        Donne-lui un angle, un framework, ou choisis une suggestion ci-dessous. Il
        écrit des scripts Reels B2B authentiques — pas de pitch direct, valeur d&apos;abord.
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
                Reel Doctor peut quand même générer, mais la qualité sera meilleure
                avec ton onboarding rempli. Va dans <strong>Paramètres → Mon brief</strong>.
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
            className="text-left px-4 py-3 bg-white border-3 border-black font-medium text-sm hover:bg-lf-pink hover:text-black hover:shadow-[4px_4px_0_#000] transition-all"
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
  const cleaned = isUser ? msg.content : stripScriptBlocksFromText(msg.content);

  if (!isUser && !cleaned) return null;

  return (
    <div className={`flex gap-3 items-start ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-8 h-8 border-3 border-black rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? "bg-lf-blue text-white" : "bg-lf-pink"
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
            isUser ? "prose-invert prose-strong:text-white" : "prose-strong:font-black"
          }`}
        >
          <ReactMarkdown>{cleaned}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function ScriptCard({
  index,
  script,
  copied,
  onCopy,
}: {
  index: number;
  script: GeneratedScript;
  copied: boolean;
  onCopy: () => void;
}) {
  const PlatformIcon = PLATFORM_ICON[script.platform];
  const duration = script.duration_seconds;
  const durationBand =
    duration === null
      ? null
      : duration <= 30
      ? { label: "Court", cls: "bg-white" }
      : duration <= 60
      ? { label: "Optimal", cls: "bg-lf-green text-white" }
      : { label: "Long", cls: "bg-lf-yellow" };

  return (
    <div className="card-brutal p-4 flex flex-col gap-3 bg-white">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-wider bg-lf-black text-white px-2 py-1">
            #{index}
          </span>
          {script.framework && (
            <span className="text-[10px] font-black uppercase tracking-wider bg-lf-pink text-black border-2 border-black px-2 py-1">
              <Hash className="w-2.5 h-2.5 inline mr-0.5" />
              {script.framework}
            </span>
          )}
          <span className="text-[10px] font-black uppercase tracking-wider bg-white border-2 border-black px-2 py-1 inline-flex items-center gap-1">
            <PlatformIcon className="w-2.5 h-2.5" />
            {PLATFORM_LABEL[script.platform]}
          </span>
          {duration !== null && durationBand && (
            <span
              className={`text-[10px] font-black uppercase tracking-wider border-2 border-black px-2 py-1 inline-flex items-center gap-1 ${durationBand.cls}`}
            >
              <Clock className="w-2.5 h-2.5" />
              {duration}s · {durationBand.label}
            </span>
          )}
        </div>
        <button
          onClick={onCopy}
          className={`flex items-center justify-center w-8 h-8 border-3 border-black transition-all flex-shrink-0 ${
            copied ? "bg-lf-green text-white" : "bg-white hover:bg-lf-pink hover:shadow-[3px_3px_0_#000]"
          }`}
          title="Copier le script"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {script.hook && (
        <div className="border-l-3 border-lf-pink pl-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-1">
            Hook (0-3s)
          </p>
          <p className="text-sm font-black leading-snug">{script.hook}</p>
        </div>
      )}

      <div className="text-xs font-medium whitespace-pre-wrap leading-relaxed border-t-3 border-black pt-3 font-mono">
        {script.body}
      </div>
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
                Onboarding peu rempli — la qualité des scripts sera limitée. Va dans Paramètres → Mon brief.
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
              Aucun brief pour l&apos;instant.
            </p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c.id)}
              className={`text-left p-3 border-3 border-black transition-all ${
                c.id === activeId
                  ? "bg-lf-black text-white"
                  : "bg-white hover:bg-lf-pink hover:shadow-[3px_3px_0_#000]"
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
