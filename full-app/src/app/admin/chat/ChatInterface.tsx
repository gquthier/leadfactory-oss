"use client";

import { useState, useRef, useEffect } from "react";
import { RefreshCw, Paperclip, Send, Image, Plus, Download, Check, X, Zap, Users, User } from "lucide-react";
import ReactMarkdown from "react-markdown";

// ─── Types ───────────────────────────────────────────────────────────────────

type MessageRole = "user" | "assistant";
type ChatTab = "leadbot" | "openclaw";

interface OcMessage {
  role: "user" | "assistant";
  content: string;
  imageUrls?: string[];
  isAction?: boolean;
}

type PendingAction = {
  type: string;
  params: Record<string, string>;
};

type MessagePart =
  | { type: "text"; content: string }
  | { type: "image"; base64: string; mimeType: string; label?: string }
  | { type: "generated-image"; base64: string; mimeType: string; prompt: string }
  | { type: "pending-action"; action: PendingAction }
  | { type: "action-result"; success: boolean; message: string };

interface Message {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  timestamp: Date;
}

interface Client {
  id: string;
  full_name: string;
  company: string | null;
  email: string;
}

interface Props {
  clients: Client[];
  isAdmin: boolean;
}

// ─── Quick Actions ────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  {
    icon: "📝",
    label: "Ad Copy 15 variations",
    prompt:
      "Génère 15 variations de copy Meta Ads (texte principal, headline, description) en utilisant les 10 frameworks de copywriting. Utilise le contexte client chargé si disponible.",
  },
  {
    icon: "🎬",
    label: "Script VSL complet",
    prompt:
      "Écris un script VSL complet (5-7 min) en suivant la structure en 8 étapes. Format: *italique* pour les notes de réalisation, texte brut pour la VO.",
  },
  {
    icon: "📱",
    label: "Scripts vidéo 30-60s",
    prompt:
      "Écris 5 scripts de vidéo publicitaire (versions 30s et 60s) avec 4 types de hooks Hormozi différents (Label, Yes-Question, If-Then, Résultat Ridicule).",
  },
  {
    icon: "🖼",
    label: "Brief créatives statiques",
    prompt:
      "Crée les briefs pour un pack de 8 créatives statiques Meta 1080x1080, une par layout template (Grosse promesse, Avant/Après, Timeline, Proof Stack, Testimonial, Transformation, Offre+Garantie, Urgence).",
  },
  {
    icon: "🔍",
    label: "Analyser cette créative",
    prompt:
      "Analyse cette créative selon les critères QA Meta : lisibilité headline, clarté de l'offre (ce qu'on fait + délai + prix), CTA, cohérence message, et donne 3 améliorations concrètes.",
  },
  {
    icon: "🎯",
    label: "Sophistication marché",
    prompt:
      "Évalue le niveau de sophistication du marché (1-5) pour ce client et recommande la stratégie d'approche copywriting adaptée.",
  },
  {
    icon: "📊",
    label: "Analyse performance",
    prompt:
      "Explique comment calculer le hit rate des créatives, identifier les winners, et optimiser le budget selon le framework Hormozi (LTGP:CAC ≥ 3:1).",
  },
];

// ─── Markdown-lite renderer ───────────────────────────────────────────────────

function renderMarkdownLite(text: string): React.ReactNode[] {
  // Split on code blocks first
  const codeBlockRegex = /```[\s\S]*?```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  const processInline = (chunk: string, baseKey: number): React.ReactNode[] => {
    // Process bold, italic, line breaks
    const inlineResult: React.ReactNode[] = [];
    const lines = chunk.split("\n");
    lines.forEach((line, li) => {
      // Bold + italic inline
      const segments: React.ReactNode[] = [];
      const boldItalicRe = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*)/g;
      let lIdx = 0;
      let m2;
      while ((m2 = boldItalicRe.exec(line)) !== null) {
        if (m2.index > lIdx) {
          segments.push(line.slice(lIdx, m2.index));
        }
        if (m2[2]) {
          // bold+italic
          segments.push(
            <strong key={`bi-${baseKey}-${li}-${m2.index}`}>
              <em>{m2[2]}</em>
            </strong>
          );
        } else if (m2[3]) {
          // bold
          segments.push(
            <strong key={`b-${baseKey}-${li}-${m2.index}`}>{m2[3]}</strong>
          );
        } else if (m2[4]) {
          // italic
          segments.push(
            <em key={`i-${baseKey}-${li}-${m2.index}`}>{m2[4]}</em>
          );
        }
        lIdx = m2.index + m2[0].length;
      }
      if (lIdx < line.length) segments.push(line.slice(lIdx));

      inlineResult.push(<span key={`line-${baseKey}-${li}`}>{segments}</span>);
      if (li < lines.length - 1) inlineResult.push(<br key={`br-${baseKey}-${li}`} />);
    });
    return inlineResult;
  };

  codeBlockRegex.lastIndex = 0;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index);
      parts.push(...processInline(chunk, key++));
    }
    const code = match[0].replace(/^```\w*\n?/, "").replace(/```$/, "");
    parts.push(
      <pre
        key={`code-${key++}`}
        className="bg-gray-100 border-2 border-black p-3 text-xs overflow-x-auto my-2 font-mono"
      >
        {code}
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const chunk = text.slice(lastIndex);
    parts.push(...processInline(chunk, key++));
  }

  return parts;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ChatInterface({ clients, isAdmin }: Props) {
  // ── LeadBot state ──────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [attachedImage, setAttachedImage] = useState<{
    base64: string;
    mimeType: string;
    preview: string;
  } | null>(null);
  const [imageMode, setImageMode] = useState(false);

  // ── Tab state ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ChatTab>("leadbot");

  useEffect(() => {
    if (!isAdmin && activeTab === "openclaw") {
      setActiveTab("leadbot");
    }
  }, [isAdmin, activeTab]);

  // ── OpenClaw state ──────────────────────────────────────────────────────────
  const [ocMessages, setOcMessages] = useState<OcMessage[]>([]);
  const [ocInput, setOcInput] = useState("");
  const [ocLoading, setOcLoading] = useState(false);
  const [ocImages, setOcImages] = useState<string[]>([]);
  const ocConversationId = useRef<string>(`conv_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const ocMessagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocFileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    ocMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ocMessages, ocLoading]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineH = 24;
    const maxH = lineH * 6 + 24;
    ta.style.height = Math.min(ta.scrollHeight, maxH) + "px";
  }, [input]);

  // ─── sendMessage ───────────────────────────────────────────────────────────

  const sendMessage = async (messageText?: string) => {
    const text = messageText !== undefined ? messageText : input.trim();
    if (!text && !attachedImage) return;
    if (loading) return;

    const userParts: MessagePart[] = [];
    if (attachedImage) {
      userParts.push({
        type: "image",
        base64: attachedImage.base64,
        mimeType: attachedImage.mimeType,
      });
    }
    if (text) userParts.push({ type: "text", content: text });

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      parts: userParts,
      timestamp: new Date(),
    };

    const currentAttached = attachedImage;
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setAttachedImage(null);
    setLoading(true);

    // Build history (text only for context window)
    const history = messages.slice(-20).map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: m.parts
        .filter((p) => p.type === "text")
        .map((p) => ({ text: (p as { type: "text"; content: string }).content })),
    }));

    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          clientId: selectedClient?.id,
          imageBase64: currentAttached?.base64,
          imageMimeType: currentAttached?.mimeType,
        }),
      });
      const data = await res.json();

      const assistantParts: MessagePart[] = [];
      if (data.text) assistantParts.push({ type: "text", content: data.text });
      if (data.pendingAction) {
        assistantParts.push({ type: "pending-action", action: data.pendingAction as PendingAction });
      }
      if (!assistantParts.length) {
        assistantParts.push({ type: "text", content: "Erreur de réponse" });
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        parts: assistantParts,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          parts: [{ type: "text", content: "Erreur de connexion. Réessayez." }],
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // ─── generateImage ─────────────────────────────────────────────────────────

  const generateImage = async () => {
    const prompt = input.trim();
    if (!prompt) return;
    setImageLoading(true);

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "user",
        parts: [{ type: "text", content: `🎨 Générer une image : ${prompt}` }],
        timestamp: new Date(),
      },
    ]);
    setInput("");

    try {
      const res = await fetch("/api/admin/chat/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, clientId: selectedClient?.id }),
      });
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          parts: [
            ...(data.text
              ? [{ type: "text" as const, content: data.text }]
              : []),
            ...(data.imageBase64
              ? [
                  {
                    type: "generated-image" as const,
                    base64: data.imageBase64,
                    mimeType: data.mimeType,
                    prompt,
                  },
                ]
              : []),
          ],
          timestamp: new Date(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          parts: [
            { type: "text", content: "Erreur lors de la génération d'image." },
          ],
          timestamp: new Date(),
        },
      ]);
    } finally {
      setImageLoading(false);
    }
  };

  // ─── handleImageUpload ─────────────────────────────────────────────────────

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      setAttachedImage({ base64, mimeType: file.type, preview: result });
    };
    reader.readAsDataURL(file);
    // Reset so same file can be re-uploaded
    e.target.value = "";
  };

  // ─── handleKeyDown ─────────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (imageMode) generateImage();
      else sendMessage();
    }
  };

  // ─── handlePaste (image) ───────────────────────────────────────────────────

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          setAttachedImage({
            base64: result.split(",")[1],
            mimeType: file.type,
            preview: result,
          });
        };
        reader.readAsDataURL(file);
      }
    }
  };

  // ─── newChat ───────────────────────────────────────────────────────────────

  const newChat = () => {
    setMessages([]);
    setInput("");
    setAttachedImage(null);
    setImageMode(false);
  };

  // ─── newOcChat ─────────────────────────────────────────────────────────────

  const newOcChat = () => {
    setOcMessages([]);
    setOcInput("");
    setOcImages([]);
    ocConversationId.current = `conv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  };

  // ─── sendOcMessage ─────────────────────────────────────────────────────────

  const sendOcMessage = async (text: string, images: string[]) => {
    if (!isAdmin) return;
    if (!text.trim() && images.length === 0) return;
    if (ocLoading) return;

    const userMsg: OcMessage = { role: "user", content: text, imageUrls: images };
    setOcMessages((prev) => [...prev, userMsg]);
    setOcInput("");
    setOcImages([]);
    setOcLoading(true);

    try {
      const res = await fetch("/api/admin/openclaw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMessage: text,
          conversationId: ocConversationId.current,
          images,
          context: {
            clientName: selectedClient
              ? selectedClient.company || selectedClient.full_name
              : undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur OpenClaw");

      const responseText =
        typeof data.data === "string"
          ? data.data
          : data.data?.message || data.data?.response || JSON.stringify(data.data, null, 2);

      setOcMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: responseText,
          isAction: data.data?.type === "action",
        },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setOcMessages((prev) => [...prev, { role: "assistant", content: `Erreur : ${msg}` }]);
    } finally {
      setOcLoading(false);
    }
  };

  // ─── handleOcImageUpload ───────────────────────────────────────────────────

  const handleOcImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setOcImages((prev) => [...prev, result]);
      };
      reader.readAsDataURL(file);
    });
    if (e.target) e.target.value = "";
  };

  // ─── executeAction (after user confirms) ───────────────────────────────────

  const executeAction = async (msgId: string, action: PendingAction) => {
    if (action.type === "create_custom_audience") {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/meta/create-audience", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.params),
        });
        const data = await res.json();

        // Replace pending-action part with result
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === msgId
              ? {
                  ...msg,
                  parts: msg.parts.map((p) =>
                    p.type === "pending-action"
                      ? {
                          type: "action-result" as const,
                          success: !!data.success,
                          message: data.success
                            ? `✓ Audience créée (ID: ${data.audience?.id})`
                            : `✗ ${data.error}`,
                        }
                      : p
                  ),
                }
              : msg
          )
        );

        // Add AI result message
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant" as MessageRole,
            parts: [
              {
                type: "text" as const,
                content: data.success
                  ? `✅ Audience **"${action.params.name}"** créée avec succès !\n\nID Meta : \`${data.audience?.id}\`\n\nElle est maintenant disponible dans votre Ads Manager sous le compte \`${action.params.ad_account_id}\`.`
                  : `❌ Impossible de créer l'audience : ${data.error}`,
              },
            ],
            timestamp: new Date(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    }
  };

  // ─── cancelAction ───────────────────────────────────────────────────────────

  const cancelAction = (msgId: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === msgId
          ? {
              ...msg,
              parts: msg.parts.map((p) =>
                p.type === "pending-action"
                  ? { type: "action-result" as const, success: false, message: "Action annulée." }
                  : p
              ),
            }
          : msg
      )
    );
  };

  const isWorking = loading || imageLoading;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── LEFT PANEL ── */}
      <aside className="hidden lg:flex w-64 flex-shrink-0 border-r-3 border-black bg-white flex-col">
        {/* Context header */}
        <div className="px-4 py-4 border-b-3 border-black bg-lf-black text-white">
          <p className="text-xs font-black uppercase tracking-wider text-white/60 mb-1">
            Contexte client
          </p>
          <select
            value={selectedClient?.id ?? ""}
            onChange={(e) => {
              const c = clients.find((cl) => cl.id === e.target.value) ?? null;
              setSelectedClient(c);
            }}
            className="w-full bg-white text-black border-2 border-white/30 px-2 py-2 text-xs font-bold focus:outline-none cursor-pointer"
          >
            <option value="">— Aucun client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company || c.full_name}
              </option>
            ))}
          </select>
          {selectedClient && (
            <div className="mt-2 text-xs text-white/60 font-medium">
              <p className="font-black text-white truncate">
                {selectedClient.full_name}
              </p>
              <p className="truncate">{selectedClient.email}</p>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
          <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2 px-1">
            Actions rapides
          </p>
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                setImageMode(false);
                sendMessage(action.prompt);
              }}
              disabled={isWorking}
              className="flex items-start gap-2 px-3 py-2 text-left border-2 border-transparent hover:border-black hover:bg-lf-yellow transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="text-base flex-shrink-0 mt-0.5">{action.icon}</span>
              <p className="font-bold text-xs uppercase leading-tight">{action.label}</p>
            </button>
          ))}
        </div>
      </aside>

      {/* ── MAIN CHAT AREA ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ── Tab bar ── */}
        <div className="flex items-center border-b-3 border-black bg-white flex-shrink-0">
          {/* LeadBot tab */}
          <button
            onClick={() => setActiveTab("leadbot")}
            className={`flex items-center gap-2 px-5 py-3 font-black text-xs uppercase tracking-wider border-r-3 border-black transition-colors ${
              activeTab === "leadbot" ? "bg-lf-black text-white" : "hover:bg-lf-yellow"
            }`}
          >
            <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 border border-current ${activeTab === "leadbot" ? "bg-lf-blue border-lf-blue" : "bg-lf-blue border-lf-blue"}`}>
              <span className="font-black text-white text-[9px]">LB</span>
            </div>
            LeadBot
          </button>

          {/* OpenClaw tab (admin only) */}
          {isAdmin && (
            <button
              onClick={() => setActiveTab("openclaw")}
              className={`flex items-center gap-2 px-5 py-3 font-black text-xs uppercase tracking-wider border-r-3 border-black transition-colors ${
                activeTab === "openclaw" ? "text-white" : "hover:bg-gray-50"
              }`}
              style={activeTab === "openclaw" ? { backgroundColor: "#7c3aed" } : {}}
            >
              <Zap className="w-3.5 h-3.5 flex-shrink-0" />
              OpenClaw
            </button>
          )}

          <div className="flex-1" />

          {/* Context label */}
          {selectedClient && (
            <p className="hidden md:block text-xs text-lf-gray font-medium px-3 truncate max-w-[180px]">
              <span className="font-black text-black">{selectedClient.company || selectedClient.full_name}</span>
            </p>
          )}

          {/* New chat button */}
          <button
            onClick={activeTab === "leadbot" ? newChat : newOcChat}
            className="flex items-center gap-2 px-4 py-3 border-l-3 border-black bg-white font-bold text-xs uppercase hover:bg-lf-yellow transition-colors"
          >
            <Plus className="w-3 h-3" />
            Nouveau
          </button>
        </div>

        {/* ── LEADBOT CONTENT ── */}
        {activeTab === "leadbot" && (<>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-canvas">
          {messages.length === 0 ? (
            // Welcome screen
            <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
              <div className="w-16 h-16 bg-lf-blue border-3 border-black flex items-center justify-center">
                <span className="font-black text-white text-2xl">LB</span>
              </div>
              <div className="text-center max-w-md">
                <h2 className="font-black uppercase text-xl tracking-tight mb-2">
                  LeadBot — Meta Ads AI
                </h2>
                <p className="text-lf-gray font-medium text-sm">
                  Expert en copywriting Meta, scripts VSL et créatives
                  statiques. Charge un client dans le panneau gauche pour
                  personnaliser le contexte.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
                {QUICK_ACTIONS.slice(0, 4).map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendMessage(action.prompt)}
                    className="card-brutal-sm p-3 text-left hover:bg-lf-yellow transition-colors"
                  >
                    <span className="text-xl">{action.icon}</span>
                    <p className="font-black text-xs uppercase mt-1">
                      {action.label}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onConfirmAction={executeAction}
                  onCancelAction={cancelAction}
                />
              ))}
              {isWorking && (
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 bg-lf-blue border-2 border-black flex items-center justify-center flex-shrink-0">
                    <span className="font-black text-white text-xs">LB</span>
                  </div>
                  <div className="bg-white border-3 border-black px-4 py-3 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-lf-blue" />
                    <span className="text-sm font-medium text-lf-gray">
                      {imageLoading ? "Génération en cours…" : "En train de répondre…"}
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input area */}
        <div className="border-t-3 border-black p-4 bg-white flex-shrink-0">
          {/* Image preview */}
          {attachedImage && (
            <div className="mb-3 flex items-center gap-3 p-2 border-2 border-black bg-canvas">
              <img
                src={attachedImage.preview}
                alt="Image attachée"
                className="w-14 h-14 object-cover border-2 border-black"
              />
              <div className="flex-1">
                <p className="text-xs font-black uppercase">Image attachée</p>
                <p className="text-xs text-lf-gray font-medium">
                  {attachedImage.mimeType}
                </p>
              </div>
              <button
                onClick={() => setAttachedImage(null)}
                className="text-xs font-black text-red-500 border-2 border-red-500 px-2 py-1 hover:bg-red-50 transition-colors"
              >
                Retirer
              </button>
            </div>
          )}

          {/* Image mode banner */}
          {imageMode && (
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-lf-blue">
              <Image className="w-3 h-3" />
              Mode génération d'image actif — décris l'image à créer
            </div>
          )}

          <div className="flex items-end gap-2">
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                imageMode
                  ? "Décris l'image à générer…"
                  : "Message à LeadBot… (Shift+Enter pour nouvelle ligne)"
              }
              rows={1}
              disabled={isWorking}
              className="flex-1 resize-none bg-white border-3 border-black px-4 py-3 font-medium text-black placeholder:text-gray-400 focus:outline-none focus:shadow-brutal-sm focus:translate-x-[-2px] focus:translate-y-[-2px] transition-all duration-100 disabled:opacity-50 min-h-[48px] max-h-[144px] overflow-y-auto"
              style={{ lineHeight: "24px" }}
            />

            {/* Upload image button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isWorking || imageMode}
              title="Joindre une image"
              className="flex items-center justify-center w-12 h-12 border-3 border-black bg-white hover:bg-lf-yellow transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Generate image toggle */}
            <button
              type="button"
              onClick={() => {
                setImageMode((v) => !v);
                setAttachedImage(null);
              }}
              disabled={isWorking}
              title={imageMode ? "Mode image ON — cliquer pour désactiver" : "Mode génération image"}
              className={`flex items-center justify-center w-12 h-12 border-3 border-black transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                imageMode
                  ? "bg-lf-blue text-white hover:bg-blue-600"
                  : "bg-white hover:bg-lf-yellow"
              }`}
            >
              <Image className="w-4 h-4" />
            </button>

            {/* Send button */}
            <button
              type="button"
              onClick={() => {
                if (imageMode) generateImage();
                else sendMessage();
              }}
              disabled={isWorking || (!input.trim() && !attachedImage)}
              className="flex items-center justify-center w-12 h-12 border-3 border-black bg-lf-black text-white hover:bg-lf-blue transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              {isWorking ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-xs text-lf-gray font-medium">
              Entrée pour envoyer · Shift+Entrée pour nouvelle ligne ·{" "}
              {imageMode ? (
                <span className="text-lf-blue font-black">Mode image actif</span>
              ) : (
                "Colle une image directement"
              )}
            </p>
            <p className="text-xs font-bold text-amber-600">
              ⚠️ Aucun historique conservé — pensez à copier vos résultats
            </p>
          </div>
        </div>

        {/* ── END LEADBOT ── */}
        </>)}

        {/* ── OPENCLAW CONTENT ── */}
        {isAdmin && activeTab === "openclaw" && (<>

          {/* OC Messages area */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-canvas">
            {ocMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
                <div
                  className="w-16 h-16 border-3 border-black flex items-center justify-center"
                  style={{ backgroundColor: "#7c3aed" }}
                >
                  <Zap className="w-8 h-8 text-white" />
                </div>
                <div className="text-center max-w-md">
                  <h2 className="font-black uppercase text-xl tracking-tight mb-2">
                    OpenClaw — Mode Action
                  </h2>
                  <p className="text-lf-gray font-medium text-sm">
                    Agent adforge connecté. Donne un ordre direct pour créer des campagnes,
                    générer des rapports ou optimiser des enchères.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
                  {[
                    { icon: "⚡", label: "Créer une campagne Meta", prompt: "Crée une nouvelle campagne Meta Ads pour ce client" },
                    { icon: "📊", label: "Rapport de performance", prompt: "Génère un rapport de performance complet" },
                    { icon: "🎯", label: "Optimiser les enchères", prompt: "Analyse et optimise les enchères des campagnes actives" },
                    { icon: "🖼", label: "Analyse créatives", prompt: "Analyse les créatives actuelles et propose des améliorations" },
                  ].map((action) => (
                    <button
                      key={action.label}
                      onClick={() => sendOcMessage(action.prompt, [])}
                      className="border-3 border-black p-3 text-left hover:border-purple-500 transition-colors bg-white"
                      style={{ borderColor: "" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f3e8ff")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                    >
                      <span className="text-xl">{action.icon}</span>
                      <p className="font-black text-xs uppercase mt-1">{action.label}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {ocMessages.map((msg, i) => (
                  <div key={i} className={`flex items-start gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    {/* Avatar */}
                    {msg.role === "user" ? (
                      <div className="w-7 h-7 bg-lf-blue border-2 border-black flex items-center justify-center flex-shrink-0 mt-0.5">
                        <User className="w-4 h-4 text-white" />
                      </div>
                    ) : (
                      <div
                        className="w-7 h-7 flex items-center justify-center border-2 border-black text-white text-xs font-black flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: "#7c3aed" }}
                      >
                        OC
                      </div>
                    )}

                    <div className={`flex-1 max-w-[80%] border-3 border-black p-3 ${msg.role === "user" ? "bg-lf-black text-white" : "bg-white"}`}>
                      {/* Action badge */}
                      {msg.role === "assistant" && msg.isAction && (
                        <span className="inline-block text-xs font-black uppercase px-2 py-0.5 bg-lf-yellow border-2 border-black mb-2 mr-2">
                          Action
                        </span>
                      )}

                      {/* Image attachments */}
                      {msg.role === "user" && msg.imageUrls && msg.imageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {msg.imageUrls.map((url, j) => (
                            <img
                              key={j}
                              src={url}
                              alt={`Image ${j + 1}`}
                              className="w-20 h-20 object-cover border-2 border-white/40"
                            />
                          ))}
                        </div>
                      )}

                      {/* Text */}
                      {msg.role === "user" ? (
                        <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      ) : (
                        <div className="text-sm font-medium leading-relaxed">
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
                              blockquote: ({ children }) => <blockquote className="border-l-4 pl-3 italic my-2" style={{ borderColor: "#7c3aed" }}>{children}</blockquote>,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {ocLoading && (
                  <div className="flex items-start gap-3">
                    <div
                      className="w-7 h-7 flex items-center justify-center border-2 border-black text-white text-xs font-black flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: "#7c3aed" }}
                    >
                      OC
                    </div>
                    <div className="bg-white border-3 border-black px-4 py-3 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: "#7c3aed" }} />
                      <span className="text-sm font-medium text-lf-gray">Action en cours…</span>
                    </div>
                  </div>
                )}

                <div ref={ocMessagesEndRef} />
              </>
            )}
          </div>

          {/* OC Input area */}
          <div className="border-t-3 border-black p-4 bg-white flex-shrink-0">
            {/* Pending image thumbnails */}
            {ocImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 p-2 border-2 border-black bg-canvas">
                {ocImages.map((url, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={url}
                      alt={`Image ${i + 1}`}
                      className="w-16 h-16 object-cover border-2 border-black"
                    />
                    <button
                      type="button"
                      onClick={() => setOcImages((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-lf-black text-white border-2 border-black flex items-center justify-center text-xs font-black hover:bg-red-600 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* Hidden OC file input */}
              <input
                ref={ocFileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleOcImageUpload}
              />

              {/* Paperclip */}
              <button
                type="button"
                onClick={() => ocFileInputRef.current?.click()}
                disabled={ocLoading}
                title="Joindre une image"
                className="flex items-center justify-center w-12 h-12 border-3 border-black bg-white hover:bg-gray-50 transition-colors disabled:opacity-40 flex-shrink-0"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Input */}
              <textarea
                value={ocInput}
                onChange={(e) => setOcInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendOcMessage(ocInput.trim(), ocImages);
                  }
                }}
                placeholder="Donne un ordre ou pose une question… (Shift+Entrée pour nouvelle ligne)"
                rows={1}
                disabled={ocLoading}
                className="flex-1 resize-none border-3 border-black px-4 py-3 font-medium text-black placeholder:text-gray-400 focus:outline-none transition-all duration-100 disabled:opacity-50 min-h-[48px] max-h-[144px] overflow-y-auto bg-white"
                style={{ lineHeight: "24px" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#7c3aed")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#000")}
              />

              {/* Send */}
              <button
                type="button"
                onClick={() => sendOcMessage(ocInput.trim(), ocImages)}
                disabled={ocLoading || (!ocInput.trim() && ocImages.length === 0)}
                className="flex items-center justify-center w-12 h-12 border-3 border-black text-white transition-colors disabled:opacity-40 flex-shrink-0"
                style={{ backgroundColor: "#7c3aed" }}
                onMouseEnter={(e) => { if (!ocLoading) e.currentTarget.style.backgroundColor = "#6d28d9"; }}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#7c3aed")}
              >
                {ocLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>

            <p className="text-xs text-lf-gray font-medium mt-2 text-center">
              OpenClaw · adforge · Mode Action Direct
            </p>
          </div>

        {/* ── END OPENCLAW ── */}
        </>)}

      </div>

      {/* Hidden file input (LeadBot) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />
    </div>
  );
}

// ─── ActionConfirmCard ────────────────────────────────────────────────────────

function ActionConfirmCard({
  action,
  messageId,
  onConfirm,
  onCancel,
}: {
  action: PendingAction;
  messageId: string;
  onConfirm: (msgId: string, action: PendingAction) => void;
  onCancel: (msgId: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);

  if (action.type === "create_custom_audience") {
    const subtypeLabel: Record<string, string> = {
      CUSTOM: "Liste personnalisée",
      WEBSITE: "Visiteurs site (Pixel)",
      ENGAGEMENT: "Engagement FB/IG",
    };

    return (
      <div className="border-3 border-black overflow-hidden max-w-sm">
        <div className="px-4 py-2 bg-lf-blue text-white flex items-center gap-2">
          <Users className="w-4 h-4" />
          <span className="font-black uppercase text-xs tracking-wider">Créer une audience Meta</span>
        </div>
        <div className="p-4 bg-lf-yellow flex flex-col gap-3">
          {/* Details */}
          <div className="bg-white border-3 border-black p-3 flex flex-col gap-1.5 text-sm">
            <div className="flex gap-2 items-start">
              <span className="font-black text-xs text-lf-gray uppercase w-20 flex-shrink-0 mt-0.5">Nom</span>
              <span className="font-black">{action.params.name}</span>
            </div>
            <div className="flex gap-2 items-start">
              <span className="font-black text-xs text-lf-gray uppercase w-20 flex-shrink-0 mt-0.5">Compte</span>
              <span className="font-mono text-xs bg-gray-100 px-1 border border-black">{action.params.ad_account_id}</span>
            </div>
            <div className="flex gap-2 items-start">
              <span className="font-black text-xs text-lf-gray uppercase w-20 flex-shrink-0 mt-0.5">Type</span>
              <span className="font-medium">{subtypeLabel[action.params.subtype ?? "CUSTOM"] ?? action.params.subtype ?? "CUSTOM"}</span>
            </div>
            {action.params.description && (
              <div className="flex gap-2 items-start">
                <span className="font-black text-xs text-lf-gray uppercase w-20 flex-shrink-0 mt-0.5">Description</span>
                <span className="text-xs text-lf-gray">{action.params.description}</span>
              </div>
            )}
          </div>

          {/* Buttons */}
          {!confirmed ? (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmed(true);
                  onConfirm(messageId, action);
                }}
                className="flex items-center gap-2 px-3 py-2 bg-lf-green text-white border-3 border-black font-black text-xs uppercase hover:bg-green-600 transition-colors"
              >
                <Check className="w-3 h-3" /> Confirmer
              </button>
              <button
                onClick={() => onCancel(messageId)}
                className="flex items-center gap-2 px-3 py-2 bg-white border-3 border-black font-black text-xs uppercase hover:bg-red-50 transition-colors"
              >
                <X className="w-3 h-3" /> Annuler
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-lf-gray">
              <RefreshCw className="w-3 h-3 animate-spin" /> Création en cours…
            </div>
          )}
        </div>
      </div>
    );
  }

  // Generic unknown action
  return (
    <div className="border-3 border-black p-4 bg-lf-yellow max-w-sm">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4" />
        <span className="font-black uppercase text-sm">Action : {action.type}</span>
      </div>
      <pre className="text-xs font-mono bg-white border-2 border-black p-2 mb-3 overflow-x-auto">
        {JSON.stringify(action.params, null, 2)}
      </pre>
      {!confirmed ? (
        <div className="flex gap-2">
          <button
            onClick={() => { setConfirmed(true); onConfirm(messageId, action); }}
            className="flex items-center gap-2 px-3 py-2 bg-lf-green text-white border-3 border-black font-black text-xs uppercase"
          >
            <Check className="w-3 h-3" /> Confirmer
          </button>
          <button
            onClick={() => onCancel(messageId)}
            className="flex items-center gap-2 px-3 py-2 bg-white border-3 border-black font-black text-xs uppercase"
          >
            <X className="w-3 h-3" /> Annuler
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs font-bold text-lf-gray">
          <RefreshCw className="w-3 h-3 animate-spin" /> En cours…
        </div>
      )}
    </div>
  );
}

// ─── MessageBubble Component ──────────────────────────────────────────────────

function MessageBubble({
  message,
  onConfirmAction,
  onCancelAction,
}: {
  message: Message;
  onConfirmAction: (msgId: string, action: PendingAction) => void;
  onCancelAction: (msgId: string) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] flex flex-col gap-2 items-end">
          {message.parts.map((part, i) => {
            if (part.type === "image") {
              return (
                <div key={i} className="border-3 border-black overflow-hidden">
                  <img
                    src={`data:${part.mimeType};base64,${part.base64}`}
                    alt={part.label ?? "Image attachée"}
                    className="max-w-xs max-h-48 object-contain block"
                  />
                  <p className="text-xs font-black uppercase px-2 py-1 bg-lf-yellow text-center">
                    {part.label ?? "Image attachée"}
                  </p>
                </div>
              );
            }
            if (part.type === "text") {
              return (
                <div
                  key={i}
                  className="bg-lf-black text-white border-3 border-black px-4 py-3 max-w-full"
                  style={{ borderBottomRightRadius: 0 }}
                >
                  <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">
                    {part.content}
                  </p>
                </div>
              );
            }
            return null;
          })}
          <p className="text-xs text-lf-gray font-medium">
            {message.timestamp.toLocaleTimeString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div className="flex items-start gap-3">
      {/* Avatar */}
      <div className="w-7 h-7 bg-lf-blue border-2 border-black flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="font-black text-white text-xs">LB</span>
      </div>

      <div className="flex-1 max-w-[80%] flex flex-col gap-2">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <div
                key={i}
                className="bg-white border-3 border-black px-4 py-3"
              >
                <div className="text-sm font-medium leading-relaxed">
                  {renderMarkdownLite(part.content)}
                </div>
              </div>
            );
          }

          if (part.type === "generated-image") {
            const dataUrl = `data:${part.mimeType};base64,${part.base64}`;
            return (
              <div key={i} className="border-3 border-black overflow-hidden">
                <img
                  src={dataUrl}
                  alt={part.prompt}
                  className="w-full max-w-sm object-contain block"
                />
                <div className="flex items-center justify-between px-3 py-2 bg-lf-blue border-t-3 border-black">
                  <p className="text-xs font-medium text-white truncate flex-1 mr-2">
                    {part.prompt}
                  </p>
                  <a
                    href={dataUrl}
                    download={`leadbot-image-${Date.now()}.${part.mimeType.split("/")[1] ?? "png"}`}
                    className="flex items-center gap-1 text-xs font-black text-white bg-black px-2 py-1 hover:bg-lf-yellow hover:text-black transition-colors border border-white flex-shrink-0"
                  >
                    <Download className="w-3 h-3" />
                    DL
                  </a>
                </div>
              </div>
            );
          }

          if (part.type === "pending-action") {
            return (
              <ActionConfirmCard
                key={i}
                action={part.action}
                messageId={message.id}
                onConfirm={onConfirmAction}
                onCancel={onCancelAction}
              />
            );
          }

          if (part.type === "action-result") {
            return (
              <div
                key={i}
                className={`border-3 border-black px-4 py-3 flex items-center gap-2 ${
                  part.success
                    ? "bg-lf-green/10 border-lf-green text-lf-green"
                    : "bg-red-50 border-red-400 text-red-600"
                }`}
              >
                {part.success ? (
                  <Check className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <X className="w-4 h-4 flex-shrink-0" />
                )}
                <p className="text-sm font-bold">{part.message}</p>
              </div>
            );
          }

          return null;
        })}
        <p className="text-xs text-lf-gray font-medium">
          {message.timestamp.toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
