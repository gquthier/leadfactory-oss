"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import {
  ArrowLeft,
  Send,
  Loader2,
  Sparkles,
  Bot,
  User,
  Info,
  Copy,
  Check,
  PhoneCall,
  ChevronDown,
  ChevronUp,
  Pin,
  PinOff,
  Trash2,
  FileText,
  AlertTriangle,
  Download,
} from "lucide-react";
import {
  coldCallScriptSchema,
  type ColdCallScript,
} from "@/lib/cold-call-script-writer/script-schema";
import { stripScriptBlock } from "@/lib/cold-call-script-writer/strip-script-block";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface Props {
  conversationId: string;
  initialTitle: string;
  initialMessages: ChatMessage[];
  initialScript: unknown | null;
  initialPinned: boolean;
  contextSummary: Array<{ label: string; value: string }>;
}

const SUGGESTIONS = [
  "Génère-moi un premier script de cold call basé sur mon offre",
  "Rends l'opener plus direct et sec",
  "Ajoute une objection sur le prix",
  "Donne-moi une variante de pitch en 7 secondes ultra punchy",
  "Adapte le ton en mode permission-based Josh Braun",
  "Réécris les voicemails en plus court",
];

function parseScript(raw: unknown): ColdCallScript | null {
  if (!raw || typeof raw !== "object") return null;
  const v = coldCallScriptSchema.safeParse(raw);
  return v.success ? v.data : null;
}

export function ChatLayout({
  conversationId,
  initialTitle,
  initialMessages,
  initialScript,
  initialPinned,
  contextSummary,
}: Props) {
  const router = useRouter();

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [script, setScript] = useState<ColdCallScript | null>(parseScript(initialScript));
  const [title, setTitle] = useState(initialTitle);
  const [pinned, setPinned] = useState(initialPinned);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationWarning, setValidationWarning] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const send = useCallback(
    async (message: string) => {
      if (!message.trim() || sending) return;
      setError(null);
      setValidationWarning(null);
      setSending(true);

      // Optimistic UI : afficher tout de suite le message user
      const userMsg: ChatMessage = {
        role: "user",
        content: message.trim(),
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");

      try {
        const res = await fetch("/api/client/sales/cold-call-script/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: message.trim(),
            conversation_id: conversationId,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? `Erreur ${res.status}`);
          // Rollback : retire le message user optimiste
          setMessages((prev) => prev.slice(0, -1));
          setSending(false);
          return;
        }

        // Ajoute la réponse de l'assistant (texte stripped du SCRIPT_JSON)
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response ?? "",
            timestamp: new Date().toISOString(),
          },
        ]);

        // Update script si présent + valid
        if (data.script_updated && data.script) {
          const parsed = parseScript(data.script);
          if (parsed) setScript(parsed);
        }
        if (data.script_validation_error) {
          setValidationWarning(data.script_validation_error.slice(0, 300));
        }

        if (data.title && data.title !== title) {
          setTitle(data.title);
        }
      } catch (e) {
        setError((e as Error).message);
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending, title]
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  async function patchConversation(body: Record<string, unknown>) {
    await fetch(`/api/client/sales/cold-call-script/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    router.refresh();
  }

  async function destroy() {
    if (!confirm("Supprimer cette conversation et son script ?")) return;
    await fetch(`/api/client/sales/cold-call-script/conversations/${conversationId}`, {
      method: "DELETE",
    });
    router.push("/client/sales/cold-call-script");
  }

  return (
    <div className="h-full max-h-screen flex flex-col bg-canvas overflow-hidden">
      {/* Header compact */}
      <div className="flex-shrink-0 border-b-3 border-black bg-white px-4 py-3 flex items-center gap-3">
        <Link
          href="/client/sales/cold-call-script"
          className="inline-flex items-center gap-1 text-xs font-bold text-lf-gray hover:text-black"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <PhoneCall className="w-5 h-5" />
        <h1 className="font-black uppercase tracking-tight text-base truncate flex-1">
          {title}
        </h1>
        <button
          onClick={() => {
            setPinned(!pinned);
            patchConversation({ pinned: !pinned });
          }}
          className="p-1.5 border-2 border-black bg-white hover:bg-lf-yellow"
          title={pinned ? "Désépingler" : "Épingler"}
        >
          {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={destroy}
          className="p-1.5 border-2 border-red-500 bg-white hover:bg-red-50 text-red-700"
          title="Supprimer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Split 50/50 */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-0">
        {/* ─── Panneau gauche : chat ─── */}
        <div className="flex flex-col min-h-0 border-r-0 lg:border-r-3 border-black bg-white">
          {/* Context summary collapsible */}
          <div className="flex-shrink-0 border-b-3 border-black bg-lf-yellow/20">
            <button
              onClick={() => setShowContext(!showContext)}
              className="w-full flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wide hover:bg-lf-yellow/40"
            >
              <Info className="w-4 h-4" />
              Contexte client (depuis ton onboarding)
              <span className="text-lf-gray font-medium">
                · {contextSummary.length} infos chargées
              </span>
              {showContext ? (
                <ChevronUp className="w-4 h-4 ml-auto" />
              ) : (
                <ChevronDown className="w-4 h-4 ml-auto" />
              )}
            </button>
            {showContext && (
              <div className="px-4 py-3 border-t-2 border-black space-y-1.5 max-h-64 overflow-y-auto">
                {contextSummary.length === 0 ? (
                  <p className="text-xs text-lf-gray font-medium italic">
                    Aucun onboarding complété. L&apos;IA va te poser des questions de
                    base. Remplis ton onboarding dans Paramètres pour de meilleurs
                    résultats.
                  </p>
                ) : (
                  contextSummary.map((c) => (
                    <div key={c.label} className="text-xs">
                      <span className="font-black uppercase text-[10px] text-lf-gray">
                        {c.label}
                      </span>
                      <p className="font-medium line-clamp-2">{c.value}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <Sparkles className="w-10 h-10 mx-auto mb-3 text-lf-gray" />
                <p className="text-sm font-bold mb-1">
                  L&apos;IA experte cold call est prête.
                </p>
                <p className="text-xs text-lf-gray font-medium mb-6 max-w-md mx-auto">
                  Elle connaît déjà ton offre, ton ICP, tes pains. Demande-lui de
                  générer ton premier script, ou pose-lui une question.
                </p>
                <div className="grid grid-cols-1 gap-2 max-w-md mx-auto">
                  {SUGGESTIONS.slice(0, 3).map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left text-xs font-medium border-2 border-black bg-white hover:bg-lf-yellow px-3 py-2"
                    >
                      → {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}

            {sending && (
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 border-2 border-black bg-lf-yellow flex items-center justify-center flex-shrink-0">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="border-2 border-black bg-white px-3 py-2 flex items-center gap-2 text-xs font-medium">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  L&apos;IA travaille...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions chips (compact) — visibles si une conversation existe */}
          {messages.length > 0 && messages.length < 12 && (
            <div className="flex-shrink-0 px-4 py-2 border-t-2 border-black bg-canvas flex gap-1.5 overflow-x-auto">
              {SUGGESTIONS.slice(messages.length >= 2 ? 1 : 0, messages.length >= 2 ? 6 : 3).map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={sending}
                  className="text-[11px] font-bold border-2 border-black bg-white hover:bg-lf-yellow px-2 py-1 whitespace-nowrap disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="flex-shrink-0 px-4 py-2 bg-red-50 border-t-3 border-red-500 text-xs font-medium text-red-900">
              {error}
            </div>
          )}
          {validationWarning && !error && (
            <div className="flex-shrink-0 px-4 py-2 bg-yellow-50 border-t-3 border-yellow-500 text-xs font-medium text-yellow-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Script reçu mais format invalide — ancien script conservé. {validationWarning}</span>
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex-shrink-0 p-4 border-t-3 border-black bg-white"
          >
            <div className="flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Demande à l'IA — ex: 'génère-moi un premier script' ou 'rends l'opener plus direct'"
                rows={2}
                disabled={sending}
                className="input-brutal flex-1 resize-none text-sm"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className={clsx(
                  "btn-primary flex-shrink-0 inline-flex items-center gap-2 self-stretch",
                  (!input.trim() || sending) && "opacity-50 cursor-not-allowed"
                )}
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-lf-gray font-medium mt-1 text-center">
              4 crédits / tour · Enter = envoyer · Shift+Enter = nouvelle ligne
            </p>
          </form>
        </div>

        {/* ─── Panneau droit : script ─── */}
        <div className="overflow-y-auto bg-canvas">
          {script ? (
            <ScriptPanel script={script} />
          ) : (
            <ScriptEmpty hasMessages={messages.length > 0} />
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  // Pour les messages assistant, on strippe le bloc <SCRIPT_JSON>...</SCRIPT_JSON>
  // qui est persisté en DB dans content (raw_response). Le script est rendu
  // séparément dans le panneau droit, pas besoin de polluer le chat avec le JSON.
  const displayContent = isUser ? message.content : stripScriptBlock(message.content);
  const hadScriptBlock = !isUser && displayContent !== message.content.trim();
  const isEmptyAfterStrip = !isUser && displayContent.length === 0;

  return (
    <div className={clsx("flex items-start gap-2", isUser && "flex-row-reverse")}>
      <div
        className={clsx(
          "w-7 h-7 border-2 border-black flex items-center justify-center flex-shrink-0",
          isUser ? "bg-lf-blue text-white" : "bg-lf-yellow"
        )}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div
        className={clsx(
          "border-2 border-black px-3 py-2 text-sm font-medium whitespace-pre-wrap max-w-[85%]",
          isUser ? "bg-lf-blue/10" : "bg-white"
        )}
      >
        {isEmptyAfterStrip ? (
          <span className="italic text-lf-gray text-xs">
            ✓ Script mis à jour dans le panneau de droite.
          </span>
        ) : (
          <>
            {displayContent}
            {hadScriptBlock && (
              <span className="block mt-2 text-[10px] uppercase tracking-wider font-black text-lf-gray border-t border-black/20 pt-1.5">
                → script mis à jour →
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────

function ScriptEmpty({ hasMessages }: { hasMessages: boolean }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <FileText className="w-12 h-12 text-lf-gray mb-4" />
      <h3 className="text-lg font-black uppercase mb-2">Script pas encore généré</h3>
      <p className="text-sm font-medium text-lf-gray max-w-sm">
        {hasMessages
          ? "L'IA n'a pas encore produit de script dans cette conversation. Demande-lui d'en générer un."
          : "Démarre la conversation à gauche — le script apparaîtra ici et se mettra à jour à chaque itération."}
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-[10px] font-black uppercase border-2 border-black bg-white hover:bg-lf-yellow px-1.5 py-0.5 inline-flex items-center gap-1"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

// HTML autonome pour l'export PDF — ouvre dans une popup, déclenche print.
// L'utilisateur choisit "Enregistrer en PDF" dans le dialog d'impression.
function buildPrintableHtml(script: ColdCallScript): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const section = (title: string, body: string) => `
    <section>
      <h2>${esc(title)}</h2>
      ${body}
    </section>`;

  const openersHtml = script.openers
    .map(
      (o, i) => `
        <div class="card">
          <h3>${i + 1}. ${esc(o.label)}</h3>
          <p class="verbatim">${esc(o.text)}</p>
          <p class="notes"><em>Delivery :</em> ${esc(o.delivery_notes)}</p>
        </div>`
    )
    .join("");

  const discoveryHtml = script.discovery_questions
    .map(
      (q, i) => `
        <div class="card">
          <p class="q"><strong>${i + 1}. ${esc(q.question)}</strong></p>
          <p class="notes"><em>Pourquoi :</em> ${esc(q.why)}</p>
          <p class="notes"><em>Bonne réponse =</em> ${esc(q.ideal_answer_signal)}</p>
        </div>`
    )
    .join("");

  const objectionsHtml = script.objection_matrix
    .map(
      (o) => `
        <div class="card">
          <h3>"${esc(o.objection)}"</h3>
          <p class="notes"><strong>Lecture :</strong> ${esc(o.reading)}</p>
          <p class="notes danger"><strong>À éviter :</strong> ${esc(o.avoid)}</p>
          <div class="response"><strong>Réponse :</strong> ${esc(o.response)}</div>
          <p class="src">Framework : ${esc(o.framework)}</p>
        </div>`
    )
    .join("");

  const closesHtml = script.closes
    .map(
      (c, i) => `
        <div class="card">
          <h3>${i + 1}. ${esc(c.label)}</h3>
          <p class="verbatim">${esc(c.text)}</p>
          <p class="notes"><em>Delivery :</em> ${esc(c.delivery_notes)}</p>
        </div>`
    )
    .join("");

  const voicemailsHtml = script.voicemails
    .map(
      (vm) => `
        <div class="card">
          <h3>${vm.duration_seconds} sec</h3>
          <p class="verbatim">${esc(vm.text)}</p>
          <p class="notes"><em>${esc(vm.notes)}</em></p>
        </div>`
    )
    .join("");

  const gatekeeperHtml = script.gatekeeper_bypass
    .map((g, i) => `<li>${i + 1}. ${esc(g)}</li>`)
    .join("");

  const pausesHtml = script.tonality.pause_points.length
    ? `<li><strong>Pauses :</strong><ul>${script.tonality.pause_points
        .map((p) => `<li>${esc(p)}</li>`)
        .join("")}</ul></li>`
    : "";

  const pitfallsHtml = script.pitfalls
    .map((p) => `<li>${esc(p)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="${script.meta.language}">
<head>
<meta charset="utf-8" />
<title>${esc(script.meta.headline)} — Cold Call Script</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter Tight", Inter, sans-serif;
    color: #111;
    line-height: 1.5;
    font-size: 11pt;
    margin: 0;
  }
  h1 {
    font-size: 20pt;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    margin: 0 0 4mm 0;
    border-bottom: 3px solid #000;
    padding-bottom: 3mm;
  }
  h2 {
    font-size: 13pt;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    margin: 8mm 0 3mm 0;
    border-bottom: 2px solid #000;
    padding-bottom: 1.5mm;
    page-break-after: avoid;
  }
  h3 {
    font-size: 11pt;
    margin: 0 0 2mm 0;
    text-transform: uppercase;
  }
  p { margin: 0 0 2mm 0; }
  .meta {
    display: flex; flex-wrap: wrap; gap: 2mm;
    margin-bottom: 4mm;
  }
  .chip {
    border: 2px solid #000;
    padding: 1mm 2.5mm;
    font-size: 9pt;
    font-weight: bold;
    background: #fff;
  }
  .headline {
    background: #fef3c7;
    border: 2px solid #000;
    padding: 3mm 4mm;
    font-size: 11pt;
    font-weight: 800;
    margin-bottom: 5mm;
  }
  .card {
    border: 2px solid #000;
    padding: 3mm 4mm;
    margin-bottom: 3mm;
    page-break-inside: avoid;
  }
  .verbatim {
    font-weight: 500;
    white-space: pre-wrap;
  }
  .notes {
    font-size: 9.5pt;
    color: #444;
  }
  .notes.danger { color: #b91c1c; }
  .src {
    font-size: 8.5pt;
    color: #666;
    text-transform: uppercase;
    font-weight: bold;
    margin-top: 1.5mm;
  }
  .response {
    background: #d1fae5;
    border: 2px solid #000;
    padding: 2mm 3mm;
    margin: 2mm 0;
    font-size: 10.5pt;
  }
  ul {
    margin: 1mm 0 2mm 0;
    padding-left: 5mm;
  }
  li { margin-bottom: 1.5mm; }
  .mindset {
    background: #fef3c7;
    border: 2px solid #000;
    padding: 3mm 4mm;
    font-size: 11pt;
  }
  .pitch-card {
    border: 2px solid #000;
    padding: 3mm;
    margin-bottom: 2mm;
  }
  .pitch-card.l7 { background: #fee2e2; }
  .pitch-card.l15 { background: #fef3c7; }
  .pitch-card.l30 { background: #d1fae5; }
  .pitch-label {
    font-size: 9pt;
    font-weight: 800;
    text-transform: uppercase;
    margin-bottom: 1mm;
  }
  .pitfall { border-left: 4px solid #ef4444; padding-left: 2mm; }
  .header-meta {
    font-size: 9pt;
    color: #555;
    margin-bottom: 4mm;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <h1>${esc(script.meta.headline)}</h1>
  <div class="header-meta">
    Framework : <strong>${esc(script.meta.framework_used)}</strong>
    &nbsp;·&nbsp; Durée cible : <strong>${script.meta.target_call_duration_seconds}s</strong>
    &nbsp;·&nbsp; Langue : <strong>${script.meta.language.toUpperCase()}</strong>
  </div>

  ${section(
    "Mindset pré-call",
    `<div class="mindset">${esc(script.pre_call_mindset)}</div>`
  )}

  ${section("Openers", openersHtml)}

  ${section(
    "Pitch (3 longueurs)",
    `
    <div class="pitch-card l7"><div class="pitch-label">7 secondes</div><div class="verbatim">${esc(script.pitch.seven_seconds)}</div></div>
    <div class="pitch-card l15"><div class="pitch-label">15 secondes</div><div class="verbatim">${esc(script.pitch.fifteen_seconds)}</div></div>
    <div class="pitch-card l30"><div class="pitch-label">30 secondes</div><div class="verbatim">${esc(script.pitch.thirty_seconds)}</div></div>
    `
  )}

  ${section("Discovery questions", discoveryHtml)}

  ${section("Matrice d'objections", objectionsHtml)}

  ${section("Closes (booker le discovery)", closesHtml)}

  ${section("Voicemails", voicemailsHtml)}

  ${section("Gatekeeper bypass", `<ol>${gatekeeperHtml}</ol>`)}

  ${section(
    "Tonalité & posture",
    `<ul>
      <li><strong>Pace :</strong> ${esc(script.tonality.pace)}</li>
      <li><strong>Energy :</strong> ${esc(script.tonality.energy)}</li>
      <li><strong>Posture :</strong> ${esc(script.tonality.posture)}</li>
      ${pausesHtml}
    </ul>`
  )}

  ${section(
    "Pièges à éviter sur CE script",
    `<ul>${pitfallsHtml
      .replace(/<li>/g, '<li class="pitfall">')}</ul>`
  )}
</body>
</html>`;
}

function ScriptPanel({ script }: { script: ColdCallScript }) {
  function buildFullExport(): string {
    const lines: string[] = [];
    lines.push(`# ${script.meta.headline}`);
    lines.push("");
    lines.push(`Framework : ${script.meta.framework_used}`);
    lines.push(`Durée cible : ${script.meta.target_call_duration_seconds}s`);
    lines.push("");
    lines.push(`## Mindset pré-call`);
    lines.push(script.pre_call_mindset);
    lines.push("");
    lines.push(`## Openers`);
    script.openers.forEach((o, i) => {
      lines.push(`### ${i + 1}. ${o.label}`);
      lines.push(o.text);
      lines.push(`_Delivery : ${o.delivery_notes}_`);
      lines.push("");
    });
    lines.push(`## Pitch`);
    lines.push(`**7 sec** — ${script.pitch.seven_seconds}`);
    lines.push(`**15 sec** — ${script.pitch.fifteen_seconds}`);
    lines.push(`**30 sec** — ${script.pitch.thirty_seconds}`);
    lines.push("");
    lines.push(`## Discovery questions`);
    script.discovery_questions.forEach((q, i) => {
      lines.push(`${i + 1}. ${q.question}`);
      lines.push(`   _Pourquoi : ${q.why}_`);
    });
    lines.push("");
    lines.push(`## Matrice d'objections`);
    script.objection_matrix.forEach((o) => {
      lines.push(`### "${o.objection}"`);
      lines.push(`- Lecture : ${o.reading}`);
      lines.push(`- À éviter : ${o.avoid}`);
      lines.push(`- Réponse : ${o.response}`);
      lines.push(`- Framework : ${o.framework}`);
      lines.push("");
    });
    lines.push(`## Closes`);
    script.closes.forEach((c) => {
      lines.push(`### ${c.label}`);
      lines.push(c.text);
      lines.push("");
    });
    lines.push(`## Voicemails`);
    script.voicemails.forEach((vm) => {
      lines.push(`### ${vm.duration_seconds} sec`);
      lines.push(vm.text);
      lines.push("");
    });
    lines.push(`## Gatekeeper bypass`);
    script.gatekeeper_bypass.forEach((g, i) => lines.push(`${i + 1}. ${g}`));
    lines.push("");
    lines.push(`## Tonalité`);
    lines.push(`- Pace : ${script.tonality.pace}`);
    lines.push(`- Energy : ${script.tonality.energy}`);
    lines.push(`- Posture : ${script.tonality.posture}`);
    lines.push("");
    lines.push(`## Pièges à éviter`);
    script.pitfalls.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
    return lines.join("\n");
  }

  function exportToPdf() {
    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) {
      alert("Le bloqueur de pop-ups empêche l'export. Autorise les pop-ups pour ce site.");
      return;
    }
    win.document.write(buildPrintableHtml(script));
    win.document.close();
    // Laisse le HTML s'injecter puis déclenche le print dialog (l'utilisateur
    // choisit "Enregistrer en PDF" comme destination).
    win.onload = () => {
      win.focus();
      win.print();
    };
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header export */}
      <div className="card-brutal p-3 bg-lf-yellow/30 flex items-center justify-between gap-2">
        <p className="text-xs font-black flex-1">{script.meta.headline}</p>
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            onClick={exportToPdf}
            className="btn-secondary text-xs inline-flex items-center gap-1 px-2 py-1"
            title="Exporter en PDF (via dialog d'impression du navigateur)"
          >
            <Download className="w-3 h-3" /> Export PDF
          </button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(buildFullExport());
            }}
            className="btn-secondary text-xs inline-flex items-center gap-1 px-2 py-1"
          >
            <Copy className="w-3 h-3" /> Tout copier
          </button>
        </div>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-1.5">
        <Chip>Framework : {script.meta.framework_used}</Chip>
        <Chip>~{script.meta.target_call_duration_seconds}s</Chip>
        <Chip>{script.meta.language.toUpperCase()}</Chip>
      </div>

      {/* Mindset */}
      <Block title="Mindset pré-call">
        <p className="text-xs font-medium leading-relaxed bg-lf-yellow/20 p-3 border-2 border-black">
          {script.pre_call_mindset}
        </p>
      </Block>

      {/* Openers */}
      <Block title={`Openers (${script.openers.length})`}>
        <div className="space-y-2">
          {script.openers.map((o, i) => (
            <div key={i} className="border-2 border-black p-3 bg-white">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h4 className="font-black uppercase text-xs">{i + 1}. {o.label}</h4>
                <CopyButton text={o.text} />
              </div>
              <p className="text-xs font-medium leading-relaxed mb-1.5 whitespace-pre-wrap">{o.text}</p>
              <p className="text-[10px] text-lf-gray italic">{o.delivery_notes}</p>
            </div>
          ))}
        </div>
      </Block>

      {/* Pitch */}
      <Block title="Pitch (3 longueurs)">
        <div className="space-y-2">
          {[
            { label: "7s", text: script.pitch.seven_seconds, color: "bg-red-50" },
            { label: "15s", text: script.pitch.fifteen_seconds, color: "bg-lf-yellow/30" },
            { label: "30s", text: script.pitch.thirty_seconds, color: "bg-lf-green/20" },
          ].map((p, i) => (
            <div key={i} className={clsx("border-2 border-black p-3", p.color)}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4 className="font-black uppercase text-[10px]">{p.label}</h4>
                <CopyButton text={p.text} />
              </div>
              <p className="text-xs font-medium leading-relaxed whitespace-pre-wrap">{p.text}</p>
            </div>
          ))}
        </div>
      </Block>

      {/* Discovery */}
      <Block title={`Discovery questions (${script.discovery_questions.length})`}>
        <div className="space-y-2">
          {script.discovery_questions.map((q, i) => (
            <div key={i} className="border-2 border-black p-3 bg-white">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-xs font-black flex-1">{i + 1}. {q.question}</p>
                <CopyButton text={q.question} />
              </div>
              <p className="text-[10px] text-lf-gray mt-1">
                <span className="font-black">Pourquoi :</span> {q.why}
              </p>
              <p className="text-[10px] text-lf-gray">
                <span className="font-black">Bonne réponse =</span> {q.ideal_answer_signal}
              </p>
            </div>
          ))}
        </div>
      </Block>

      {/* Objections */}
      <Block title={`Objections (${script.objection_matrix.length})`}>
        <div className="space-y-2">
          {script.objection_matrix.map((o, i) => (
            <div key={i} className="border-2 border-black p-3 bg-white">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h4 className="font-black text-xs">&quot;{o.objection}&quot;</h4>
                <CopyButton text={o.response} />
              </div>
              <div className="space-y-1.5 text-[11px]">
                <p><span className="font-black uppercase text-[9px] text-lf-gray">Lecture :</span> {o.reading}</p>
                <p><span className="font-black uppercase text-[9px] text-red-700">À éviter :</span> {o.avoid}</p>
                <div className="bg-lf-green/15 border-2 border-black p-2 mt-1">
                  <p className="text-[9px] font-black uppercase mb-0.5">Réponse</p>
                  <p className="font-medium whitespace-pre-wrap">{o.response}</p>
                </div>
                <p className="text-[9px] text-lf-gray font-bold uppercase">
                  Framework : {o.framework}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Block>

      {/* Closes */}
      <Block title={`Closes (${script.closes.length})`}>
        <div className="space-y-2">
          {script.closes.map((c, i) => (
            <div key={i} className="border-2 border-black p-3 bg-white">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4 className="font-black uppercase text-xs">{i + 1}. {c.label}</h4>
                <CopyButton text={c.text} />
              </div>
              <p className="text-xs font-medium leading-relaxed whitespace-pre-wrap mb-1">{c.text}</p>
              <p className="text-[10px] text-lf-gray italic">{c.delivery_notes}</p>
            </div>
          ))}
        </div>
      </Block>

      {/* Voicemails */}
      <Block title={`Voicemails (${script.voicemails.length})`}>
        <div className="space-y-2">
          {script.voicemails.map((vm, i) => (
            <div key={i} className="border-2 border-black p-3 bg-white">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4 className="font-black uppercase text-xs">{vm.duration_seconds}s</h4>
                <CopyButton text={vm.text} />
              </div>
              <p className="text-xs font-medium leading-relaxed whitespace-pre-wrap mb-1">{vm.text}</p>
              <p className="text-[10px] text-lf-gray italic">{vm.notes}</p>
            </div>
          ))}
        </div>
      </Block>

      {/* Gatekeeper */}
      <Block title={`Gatekeeper bypass (${script.gatekeeper_bypass.length})`}>
        <div className="space-y-1.5">
          {script.gatekeeper_bypass.map((g, i) => (
            <div key={i} className="border-2 border-black p-2 bg-white flex items-start gap-2">
              <p className="text-xs font-medium flex-1">{i + 1}. {g}</p>
              <CopyButton text={g} />
            </div>
          ))}
        </div>
      </Block>

      {/* Tonalité */}
      <Block title="Tonalité">
        <div className="space-y-2 text-xs">
          <div className="border-2 border-black p-2 bg-white">
            <span className="font-black uppercase text-[10px] block">Pace</span>
            <p className="font-medium">{script.tonality.pace}</p>
          </div>
          <div className="border-2 border-black p-2 bg-white">
            <span className="font-black uppercase text-[10px] block">Energy</span>
            <p className="font-medium">{script.tonality.energy}</p>
          </div>
          <div className="border-2 border-black p-2 bg-white">
            <span className="font-black uppercase text-[10px] block">Posture</span>
            <p className="font-medium">{script.tonality.posture}</p>
          </div>
          {script.tonality.pause_points.length > 0 && (
            <div className="border-2 border-black p-2 bg-white">
              <span className="font-black uppercase text-[10px] block mb-1">Pauses</span>
              <ul className="list-disc pl-4 space-y-0.5">
                {script.tonality.pause_points.map((p, i) => (
                  <li key={i} className="font-medium">{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Block>

      {/* Pitfalls */}
      <Block title={`Pièges (${script.pitfalls.length})`}>
        <ul className="space-y-1">
          {script.pitfalls.map((p, i) => (
            <li key={i} className="border-l-4 border-red-500 pl-2 py-0.5 text-xs font-medium">
              {p}
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-2 border-black px-2 py-0.5 bg-white text-[10px] font-bold">
      {children}
    </span>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-brutal p-3">
      <h3 className="font-black uppercase text-xs tracking-tight mb-2 pb-2 border-b-2 border-black">
        {title}
      </h3>
      {children}
    </section>
  );
}
