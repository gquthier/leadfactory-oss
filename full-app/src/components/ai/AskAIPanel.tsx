"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Sparkles, Loader2, Bot, User, ChevronRight, GripVertical, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  campaignId?: string;
  isAdmin?: boolean;
  onWidthChange?: (w: number) => void;
}

// ── Suggestions ──────────────────────────────────────────────────────────────

const PRE_QUESTIONS_CLIENT = [
  "Analyse mes performances des 7 derniers jours",
  "Résumé du mois en cours",
  "Combien de leads j'ai généré ce mois-ci ?",
  "Quel est mon taux de conversion et mon cash collecté ?",
  "Analyse la tendance de mes leads",
  "Quel est mon meilleur jour de la période ?",
];

const PRE_QUESTIONS_ADMIN = [
  "Génère une créative Layout 1 — Grosse Promesse Centrale",
  "Génère une créative Layout 2 — Avant/Après",
  "Génère une créative Layout 4 — Proof Stack (3 chiffres)",
  "Écris 5 variations de copy Meta Ads (framework PAS)",
  "Génère un script vidéo 30 secondes avec hook Hormozi",
  "Analyse les performances de ce compte Meta",
];

const PERIODS = [
  { label: "7 jours", value: "last_7d" },
  { label: "30 jours", value: "last_30d" },
  { label: "90 jours", value: "last_90d" },
];

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 420;
const STORAGE_KEY = "lf-askai-width";

// ── Creative preview — HTML → PNG via Puppeteer API ──────────────────────────

function CreativePreview({ html }: { html: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedHtml, setCopiedHtml] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setError(null);

    fetch("/api/admin/html-to-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.imageBase64) {
          setImageUrl(`data:${data.mimeType ?? "image/png"};base64,${data.imageBase64}`);
        } else {
          setError(data.error ?? "Rendu échoué");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message ?? "Erreur réseau");
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });

    return () => { cancelled = true; };
  }, [html]);

  const handleCopyHtml = () => {
    navigator.clipboard.writeText(html);
    setCopiedHtml(true);
    setTimeout(() => setCopiedHtml(false), 2000);
  };

  if (rendering) {
    return (
      <div className="mt-2 border-3 border-black p-3 flex items-center gap-2 bg-white">
        <Loader2 className="w-4 h-4 animate-spin text-lf-blue flex-shrink-0" />
        <span className="text-xs font-medium text-lf-gray">Rendu créative 1080×1080...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2 border-3 border-black p-3 bg-white">
        <p className="text-xs font-bold text-red-500">Erreur de rendu : {error}</p>
        <button
          onClick={handleCopyHtml}
          className="mt-1 text-xs font-bold text-lf-blue underline"
        >
          Copier le HTML pour le rendre manuellement
        </button>
      </div>
    );
  }

  if (!imageUrl) return null;

  return (
    <div className="mt-2 border-3 border-black overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-lf-black text-white flex-shrink-0">
        <span className="text-xs font-black uppercase tracking-wider">Créative 1080×1080</span>
        <div className="flex items-center gap-3">
          <a
            href={imageUrl}
            download="creative-1080.png"
            className="flex items-center gap-1 text-xs font-bold text-white/60 hover:text-white transition-colors"
          >
            <Check className="w-3 h-3" />
            ↓ PNG
          </a>
          <button
            onClick={handleCopyHtml}
            className="flex items-center gap-1 text-xs font-bold text-white/60 hover:text-white transition-colors"
          >
            {copiedHtml ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copiedHtml ? "Copié" : "HTML"}
          </button>
        </div>
      </div>
      {/* Image */}
      <img
        src={imageUrl}
        alt="Créative générée"
        className="w-full block"
        style={{ imageRendering: "crisp-edges" }}
      />
    </div>
  );
}

// ── Extract HTML code blocks from message content ─────────────────────────────

function parseMessage(content: string): { text: string; htmlBlocks: string[] } {
  const htmlBlocks: string[] = [];
  const HTML_BLOCK_RE = /```html\n([\s\S]+?)(?:\n```|```|$)/g;
  const text = content.replace(HTML_BLOCK_RE, (_, html) => {
    htmlBlocks.push(html.trim());
    return "";
  }).trim();
  return { text, htmlBlocks };
}

// ── Main component ────────────────────────────────────────────────────────────

export function AskAIPanel({ isOpen, onClose, campaignId, isAdmin, onWidthChange }: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState("last_30d");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Width resize ─────────────────────────────────────────────────────────
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parseInt(saved, 10))) : DEFAULT_WIDTH;
  });
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const updateWidth = useCallback((w: number) => {
    setWidth(w);
    onWidthChange?.(w);
  }, [onWidthChange]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = width;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const maxW = Math.min(MAX_WIDTH, Math.floor(window.innerWidth / 2));
      const delta = dragStartX.current - e.clientX;
      const newWidth = Math.min(maxW, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
      updateWidth(newWidth);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (panelRef.current) {
        localStorage.setItem(STORAGE_KEY, String(panelRef.current.offsetWidth));
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [updateWidth]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;
    const historyForApi = messages;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          campaign_id: campaignId,
          period,
          history: historyForApi.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur inconnue");
      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : "Une erreur s'est produite.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Erreur : ${errMsg}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input); };

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setMessages([]);
    setInput("");
  };

  const preQuestions = isAdmin ? PRE_QUESTIONS_ADMIN : PRE_QUESTIONS_CLIENT;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 lg:bg-black/10"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col bg-canvas border-l-3 border-black shadow-[-8px_0_0_#000]"
        style={{ width: `min(${width}px, 50vw)` }}
      >
        {/* Drag handle */}
        <div
          onMouseDown={onMouseDown}
          className="absolute left-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-ew-resize z-10 group hover:bg-lf-yellow/40 transition-colors"
          title="Glisser pour redimensionner"
        >
          <GripVertical className="w-3 h-4 text-black/20 group-hover:text-black/60 transition-colors" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-lf-black text-white border-b-3 border-black flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-lf-yellow border-2 border-white/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-black" />
            </div>
            <div>
              <p className="font-black uppercase tracking-wider text-sm leading-none">Opti</p>
              <p className="text-xs text-white/50 font-medium mt-0.5">
                {isAdmin ? "Créatives · Copy · Analyse" : "Ton assistant analyste Meta"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Width presets */}
            <div className="hidden sm:flex items-center gap-1 mr-1">
              {[320, 420, 600, 800].map((w) => (
                <button
                  key={w}
                  onClick={() => { updateWidth(w); localStorage.setItem(STORAGE_KEY, String(w)); }}
                  title={`Largeur ${w}px`}
                  className={`w-5 h-3.5 border border-white/30 hover:border-white/70 transition-colors ${
                    Math.abs(width - w) < 30 ? "bg-lf-yellow border-lf-yellow" : "bg-transparent"
                  }`}
                  style={{ transform: `scaleX(${w / 800})` }}
                />
              ))}
            </div>
            {messages.length > 0 && (
              <button
                onClick={handleReset}
                className="text-xs font-bold text-white/50 hover:text-white px-2 py-1 border border-white/20 hover:border-white/40 transition-colors"
              >
                Reset
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:text-lf-yellow transition-colors" aria-label="Fermer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-1 px-4 py-2 border-b-3 border-black bg-white flex-shrink-0">
          <span className="text-xs font-black uppercase tracking-wider text-lf-gray mr-2">Période :</span>
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1 text-xs font-black uppercase border-2 border-black transition-all ${
                period === p.value ? "bg-lf-black text-white" : "bg-white hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col gap-3">
              <div className="text-center py-4">
                <div className="w-14 h-14 bg-lf-yellow border-3 border-black flex items-center justify-center mx-auto mb-3">
                  <Sparkles className="w-7 h-7 text-black" />
                </div>
                <p className="font-black uppercase text-sm tracking-wide">
                  {isAdmin ? "LeadBot est prêt." : "Opti est là."}
                </p>
                <p className="text-xs text-lf-gray font-medium mt-1 leading-relaxed">
                  {isAdmin
                    ? "Génère des créatives HTML, du copy Meta Ads, des scripts vidéo — ou analyse les performances."
                    : "Pose-moi une question sur tes campagnes Meta ou choisis une suggestion."}
                  {isAdmin && !campaignId && (
                    <span className="block mt-1 text-lf-blue font-black">
                      Ouvre une campagne pour charger le contexte client.
                    </span>
                  )}
                </p>
              </div>
              <p className="text-xs font-black uppercase tracking-wider text-lf-gray">Suggestions</p>
              <div className="flex flex-col gap-2">
                {preQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    disabled={loading}
                    className="flex items-center justify-between text-left text-sm font-medium px-4 py-3 border-3 border-black bg-white hover:bg-lf-yellow hover:shadow-[3px_3px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px] transition-all disabled:opacity-40"
                  >
                    <span>{q}</span>
                    <ChevronRight className="w-4 h-4 flex-shrink-0 ml-2 opacity-40" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            const { text, htmlBlocks } = parseMessage(msg.content);
            return (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 flex-shrink-0 flex items-center justify-center border-3 border-black ${msg.role === "user" ? "bg-lf-blue" : "bg-lf-yellow"}`}>
                  {msg.role === "user" ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-black" />}
                </div>
                <div className={`flex-1 min-w-0 text-sm font-medium leading-relaxed border-3 border-black p-3 break-words ${msg.role === "user" ? "bg-lf-blue text-white whitespace-pre-wrap" : "bg-white text-lf-black"}`}>
                  {msg.role === "user" ? msg.content : (
                    <>
                      {text && (
                        <ReactMarkdown
                          components={{
                            h1: ({ children }) => <h1 className="text-base font-black uppercase tracking-wide mb-2 mt-1">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-sm font-black uppercase tracking-wide mb-1.5 mt-2 first:mt-0">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-sm font-black mb-1 mt-2 first:mt-0">{children}</h3>,
                            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                            strong: ({ children }) => <strong className="font-black">{children}</strong>,
                            em: ({ children }) => <em className="italic">{children}</em>,
                            ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
                            li: ({ children }) => <li>{children}</li>,
                            code: ({ children }) => <code className="bg-gray-100 border border-gray-300 px-1 py-0.5 text-xs font-mono rounded-none">{children}</code>,
                            hr: () => <hr className="border-t-2 border-black my-2" />,
                            blockquote: ({ children }) => <blockquote className="border-l-4 border-lf-blue pl-3 italic my-2">{children}</blockquote>,
                          }}
                        >
                          {text}
                        </ReactMarkdown>
                      )}
                      {htmlBlocks.map((html, j) => (
                        <CreativePreview key={j} html={html} />
                      ))}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center border-3 border-black bg-lf-yellow">
                <Bot className="w-4 h-4 text-black" />
              </div>
              <div className="flex-1 border-3 border-black p-3 bg-white flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-lf-blue flex-shrink-0" />
                <span className="text-sm text-lf-gray font-medium">
                  {isAdmin ? "Génération en cours..." : "Analyse en cours..."}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 p-4 border-t-3 border-black bg-white">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isAdmin ? "Génère une créative, du copy, un script..." : "Pose ta question à Opti..."}
              disabled={loading}
              className="flex-1 min-w-0 px-4 py-3 border-3 border-black font-medium text-sm focus:outline-none focus:border-lf-blue bg-canvas disabled:opacity-60 transition-colors"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="px-4 py-3 bg-lf-black text-white border-3 border-black font-black disabled:opacity-40 hover:bg-lf-blue transition-colors flex-shrink-0"
              aria-label="Envoyer"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <p className="text-xs text-lf-gray font-medium mt-2 text-center">
            {isAdmin ? "Opti · Gemini 2.5 Flash · AdsAsset Skills" : "Opti · Gemini 2.5 Flash · Données Meta en temps réel"}
          </p>
        </div>
      </div>
    </>
  );
}
