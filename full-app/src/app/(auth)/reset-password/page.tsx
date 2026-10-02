"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Zap, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState<"checking" | "ready" | "invalid">("checking");

  useEffect(() => {
    const supabase = createClient();
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSessionReady("ready");
        return;
      }
      // Le SDK Supabase établit la session depuis le fragment au mount.
      // On laisse un petit délai puis on recheck.
      setTimeout(async () => {
        const { data: retry } = await supabase.auth.getSession();
        setSessionReady(retry.session ? "ready" : "invalid");
      }, 800);
    };
    check();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setSessionReady("ready");
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setError(updErr.message || "Impossible de mettre à jour le mot de passe.");
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);

    setTimeout(async () => {
      await supabase.auth.signOut();
      router.push("/login?reset=success");
    }, 2500);
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4 grid-bg">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-12 h-12 bg-lf-blue border-3 border-black rounded-full flex items-center justify-center shadow-brutal-sm">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <span className="text-3xl font-black uppercase tracking-tight">LeadFactory</span>
        </div>

        <div className="card-brutal p-8">
          {sessionReady === "checking" && (
            <div className="text-center py-8">
              <span className="animate-spin w-6 h-6 border-3 border-black border-t-transparent rounded-full inline-block" />
              <p className="text-sm font-bold mt-4">Vérification du lien...</p>
            </div>
          )}

          {sessionReady === "invalid" && (
            <>
              <div className="mb-5 flex items-center gap-3 p-4 bg-red-50 border-3 border-red-500">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                <p className="text-sm font-bold text-red-700">
                  Lien invalide ou expiré. Demande un nouveau lien de réinitialisation.
                </p>
              </div>
              <Link
                href="/forgot-password"
                className="w-full inline-flex items-center justify-center gap-2 text-sm py-4 btn-primary"
              >
                DEMANDER UN NOUVEAU LIEN
              </Link>
            </>
          )}

          {sessionReady === "ready" && !success && (
            <>
              <div className="mb-6">
                <div className="sticker -rotate-1 inline-block mb-3">NOUVEAU MOT DE PASSE</div>
                <h1 className="text-2xl font-black uppercase tracking-tight">Choisis ton nouveau mot de passe</h1>
                <p className="text-sm text-lf-gray font-medium mt-2">
                  Au moins 8 caractères. Mélange majuscules, chiffres et symboles pour plus de sécurité.
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
                  <label className="label-brutal">Nouveau mot de passe</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={8}
                      autoFocus
                      className="input-brutal pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-lf-gray hover:text-black transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label-brutal">Confirme le mot de passe</label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    className="input-brutal"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`mt-2 flex items-center justify-center gap-2 text-sm py-4 ${loading ? "btn-disabled" : "btn-primary"}`}
                >
                  {loading ? (
                    <>
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" />
                      Mise à jour...
                    </>
                  ) : (
                    "METTRE À JOUR LE MOT DE PASSE"
                  )}
                </button>
              </form>
            </>
          )}

          {success && (
            <div className="text-center py-4">
              <div className="flex items-center justify-center w-14 h-14 bg-lf-green border-3 border-black mx-auto">
                <CheckCircle2 className="w-7 h-7 text-black" />
              </div>
              <h1 className="text-2xl font-black uppercase tracking-tight mt-4">Mot de passe mis à jour !</h1>
              <p className="text-sm text-lf-gray font-medium mt-3">
                Redirection vers la connexion...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
