"use client";

import { FormEvent, useMemo, useState } from "react";
import { Monitor, MessageCircle as MessageCircleText, SendHorizonal } from "lucide-react";

const WELCOME_MESSAGE =
  "OK je vais lancer l'analyse complète de ton offre. Pour voir où on en est, comment tu peux m'appeler ?";

interface ChatMessage {
  role: "assistant" | "user";
  text: string;
}

export function ClientStartChat({ firstName }: { firstName: string }) {
  const profileName = firstName.trim() || "toi";
  const [draft, setDraft] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([
    { role: "assistant", text: WELCOME_MESSAGE },
  ]);

  const canSend = useMemo(() => draft.trim().length > 0, [draft]);
  const hasStarted = useMemo(() => chat.some((entry) => entry.role === "user"), [chat]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isTyping) return;

    const replyBase = profileName === "toi" ? "" : ` ${profileName}`;
    setChat((previous) => [...previous, { role: "user", text: message }]);
    setDraft("");
    setIsTyping(true);

    const firstWord = message.split(" ")[0];
    const answer =
      `${firstWord ? `Parfait ${firstWord},` : "Parfait,"}` +
      " j'ai bien reçu ton message. " +
      "Je lance la première passe d'analyse de ton brief et je te reviens avec les prochaines actions.";

    setTimeout(() => {
      setChat((previous) => [
        ...previous,
        {
          role: "assistant",
          text: `Très bien${replyBase}. ${answer}`,
        },
      ]);
      setIsTyping(false);
    }, 500);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0c0e11]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(46,85,255,0.25),transparent_32%),radial-gradient(circle_at_85%_10%,rgba(255,196,0,0.18),transparent_30%),linear-gradient(160deg,#0a0a0a,#111319)]" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-5xl animate-open-desktop">
          <div className="mx-auto overflow-hidden border-2 border-black/80 bg-[#0f1115] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <header className="flex items-center justify-between border-b-2 border-black/70 bg-[#191b22] px-4 py-3 text-white">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-sm border-2 border-white/40 bg-black/70">
                  <Monitor className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-lf-yellow">
                    SE DEMARRER
                  </p>
                  <p className="text-[11px] text-lf-gray">Lead Factory — Espace client</p>
                </div>
              </div>
              <p className="text-[11px] text-lf-gray">Utilisateur: {profileName}</p>
            </header>

            <section className="grid min-h-[460px] sm:min-h-[530px] md:grid-cols-[260px_1fr]">
              <aside className="hidden border-r-2 border-black/20 bg-[#eef2ff] p-4 md:flex md:flex-col">
                <p className="text-[10px] mb-4 font-black uppercase tracking-[0.25em] text-lf-gray">Applications</p>
                <button
                  type="button"
                  className="mb-2 border-2 border-black bg-lf-blue px-3 py-2 text-left text-xs font-black uppercase text-white"
                >
                  Chat
                </button>
                <button
                  type="button"
                  className="border-2 border-black bg-white px-3 py-2 text-left text-xs font-black uppercase hover:bg-lf-yellow"
                >
                  Dashboard
                </button>
                <p className="mt-auto text-xs text-lf-gray">
                  Tes informations d'onboarding sont déjà enregistrées.
                </p>
              </aside>

              <div className="bg-canvas p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h1 className="flex items-center gap-2 text-lg font-black uppercase tracking-tight sm:text-xl">
                    <MessageCircleText className="h-5 w-5" />
                    Chat de bienvenue
                  </h1>
                  <p className="text-xs text-lf-gray">Fenêtre principale</p>
                </div>

                <div className="h-[325px] overflow-auto rounded-xl border-3 border-black bg-white p-4 shadow-brutal-sm">
                  <div className="space-y-3">
                    {chat.map((entry) => (
                      <p
                        key={`${entry.role}-${entry.text}`}
                        className={`rounded-lg border-2 border-black px-4 py-3 text-sm leading-relaxed ${
                          entry.role === "assistant" ? "bg-lf-blue/15" : "bg-lf-green/15"
                        }`}
                      >
                        {entry.text}
                      </p>
                    ))}
                    {isTyping && (
                      <p className="rounded-lg border-2 border-black bg-lf-yellow/30 px-4 py-3 text-sm text-lf-gray italic">
                        L'agent écrit...
                      </p>
                    )}
                  </div>
                </div>

                <form className="mt-4" onSubmit={handleSubmit}>
                  <label className="label-brutal">
                    {hasStarted ? "Continue la discussion" : "Écris ton prénom pour démarrer"}
                  </label>
                  <div className="relative">
                    <input
                      className="input-brutal pr-16"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder={hasStarted ? "Tape ta réponse..." : "Ex : Camille"}
                    />
                    <button
                      type="submit"
                      disabled={!canSend || isTyping}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 border-2 border-black px-3 py-1 text-xs font-black uppercase transition-all ${
                        canSend && !isTyping
                          ? "bg-lf-blue text-white hover:translate-x-[1px] hover:translate-y-[1px]"
                          : "bg-gray-200 text-gray-500 border-gray-300 cursor-not-allowed"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <SendHorizonal className="h-3 w-3" />
                        Envoyer
                      </span>
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-lf-gray">
                    {hasStarted
                      ? "L'analyse commence dès ton premier message."
                      : "Réponds au message de l'agent pour ouvrir la suite."
                    }
                  </p>
                </form>
              </div>
            </section>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes open-desktop {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(24px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        .animate-open-desktop {
          animation: open-desktop 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
        }
      `}</style>
    </main>
  );
}
