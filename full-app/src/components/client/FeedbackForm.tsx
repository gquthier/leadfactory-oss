"use client";

import { useState } from "react";
import { Send, Check, MessageSquare } from "lucide-react";

const CATEGORIES = [
  { value: "outil", label: "L'outil / la plateforme" },
  { value: "campagne", label: "La gestion de campagne" },
  { value: "communication", label: "La communication & suivi" },
  { value: "resultats", label: "Les résultats" },
  { value: "autre", label: "Autre" },
];

export function FeedbackForm() {
  const [category, setCategory] = useState("outil");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!message.trim()) { setError("Merci d'écrire un message."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/client/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, category }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      setSent(true);
      setMessage("");
    } catch {
      setError("Une erreur est survenue. Réessayez.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="p-8 flex flex-col items-center gap-4 text-center">
        <div className="w-16 h-16 bg-lf-green border-3 border-black flex items-center justify-center">
          <Check className="w-8 h-8 text-white" />
        </div>
        <p className="font-black text-xl uppercase">Merci pour votre retour !</p>
        <p className="text-lf-gray font-medium">Votre feedback a bien été transmis à l'équipe Lead Factory.</p>
        <button
          onClick={() => setSent(false)}
          className="text-xs font-black uppercase text-lf-blue hover:underline mt-2"
        >
          Envoyer un autre message
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <div className="lg:col-span-3">
          <p className="font-bold text-base mb-4">
            Votre avis compte. Dites-nous ce que vous pensez de l'outil, de la collaboration,
            ou ce que nous pourrions améliorer pour mieux vous servir.
          </p>

          {/* Category */}
          <div className="mb-4">
            <label className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2 block">
              Sur quoi porte votre retour ?
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`text-xs font-black px-3 py-1.5 border-2 border-black transition-all ${
                    category === c.value
                      ? "bg-lf-black text-white"
                      : "bg-white text-black hover:bg-gray-100"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div className="mb-4">
            <label className="text-xs font-black uppercase tracking-wider text-lf-gray mb-2 block">
              Votre message *
            </label>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => { setMessage(e.target.value); setError(null); }}
              placeholder="Ce qui fonctionne bien, ce qui pourrait être amélioré, une idée de feature, un point de friction dans la collaboration..."
              className="textarea-brutal text-sm resize-none w-full"
            />
            {error && <p className="text-xs font-bold text-red-500 mt-1">{error}</p>}
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !message.trim()}
            className={`flex items-center gap-2 px-6 py-3 font-black text-sm uppercase tracking-wider border-3 border-black transition-all ${
              loading || !message.trim()
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-lf-black text-white hover:bg-lf-blue hover:shadow-brutal-sm"
            }`}
          >
            {loading ? (
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {loading ? "Envoi…" : "Envoyer mon feedback"}
          </button>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-lf-yellow border-3 border-black p-5">
            <MessageSquare className="w-8 h-8 mb-3" />
            <p className="font-black uppercase text-sm mb-2">Pourquoi votre avis est précieux</p>
            <ul className="flex flex-col gap-2">
              {[
                "Chaque retour est lu par l'équipe",
                "On améliore l'outil grâce à vous",
                "Vos idées peuvent devenir des features",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm font-medium">
                  <span className="w-4 h-4 bg-lf-black text-white flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-black">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
