"use client";

import { useState } from "react";
import Link from "next/link";
import { Zap, ArrowLeft, Mail, AlertCircle, CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error("Request failed");
      setSubmitted(true);
    } catch {
      setError("Une erreur est survenue. Réessaie dans quelques instants.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4 grid-bg">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-12 h-12 bg-lf-blue border-3 border-black rounded-full flex items-center justify-center shadow-brutal-sm">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <span className="text-3xl font-black uppercase tracking-tight">LeadFactory</span>
        </div>

        {/* Card */}
        <div className="card-brutal p-8">
          {!submitted ? (
            <>
              <div className="mb-6">
                <div className="sticker-yellow -rotate-1 inline-block mb-3">MOT DE PASSE OUBLIÉ</div>
                <h1 className="text-2xl font-black uppercase tracking-tight">Réinitialise ton accès</h1>
                <p className="text-sm text-lf-gray font-medium mt-2 leading-relaxed">
                  Saisis l&apos;email <strong className="text-black">utilisé pendant ton onboarding</strong>.
                  Tu recevras un lien pour choisir un nouveau mot de passe.
                </p>
              </div>

              {error && (
                <div className="mb-5 flex items-center gap-3 p-4 bg-red-50 border-3 border-red-500">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <p className="text-sm font-bold text-red-700">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div>
                  <label className="label-brutal">Email de ton compte</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@example.com"
                    required
                    autoFocus
                    className="input-brutal"
                  />
                  <p className="text-xs text-lf-gray font-medium mt-2">
                    Ce doit être le même email que celui renseigné lors de ton onboarding LeadFactory.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`mt-2 flex items-center justify-center gap-2 text-sm py-4 ${loading ? "btn-disabled" : "btn-primary"}`}
                >
                  {loading ? (
                    <>
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" />
                      Envoi en cours...
                    </>
                  ) : (
                    "ENVOYER LE LIEN DE RÉINITIALISATION"
                  )}
                </button>
              </form>

              <Link
                href="/login"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-black uppercase tracking-wider text-lf-gray hover:text-black transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Retour à la connexion
              </Link>
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-center w-14 h-14 bg-lf-green border-3 border-black mx-auto">
                <CheckCircle2 className="w-7 h-7 text-black" />
              </div>
              <div className="text-center mb-6">
                <h1 className="text-2xl font-black uppercase tracking-tight mt-4">C&apos;est parti !</h1>
                <p className="text-sm text-lf-gray font-medium mt-3 leading-relaxed">
                  Si un compte LeadFactory existe avec l&apos;email <strong className="text-black">{email}</strong>,
                  tu vas recevoir un lien pour réinitialiser ton mot de passe dans les prochaines minutes.
                </p>
              </div>

              <div className="card-brutal-sm p-4 bg-lf-yellow mb-5">
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider mb-1">⚠️ Vérifie tes spams</p>
                    <p className="text-xs font-medium leading-relaxed">
                      Le mail peut atterrir dans tes <strong>spams</strong> ou l&apos;onglet <strong>Promotions</strong> (Gmail).
                      Pense à le marquer comme « non spam » pour les prochains envois.
                    </p>
                  </div>
                </div>
              </div>

              <div className="text-xs text-lf-gray font-medium space-y-2 mb-6">
                <p>• Le lien est valable <strong className="text-black">1 heure</strong>.</p>
                <p>• Tu ne reçois rien après 5 min ? Vérifie l&apos;orthographe de ton email puis recommence.</p>
                <p>• Tu n&apos;es plus sûr de l&apos;email utilisé à l&apos;onboarding ? Contacte ton gestionnaire LeadFactory.</p>
              </div>

              <Link
                href="/login"
                className="w-full inline-flex items-center justify-center gap-2 text-sm py-4 btn-primary"
              >
                <ArrowLeft className="w-4 h-4" />
                RETOUR À LA CONNEXION
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
