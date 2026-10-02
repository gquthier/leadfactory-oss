"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Zap, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  // Pre-fill email and password from query params
  useEffect(() => {
    const paramEmail = searchParams.get("email");
    const paramPassword = searchParams.get("password");
    if (paramEmail) setEmail(paramEmail);
    if (paramPassword) setPassword(paramPassword);
    if (searchParams.get("disabled") === "1") {
      setError("Votre compte a été désactivé. Contactez un super admin Lead Factory.");
    }
    if (searchParams.get("error") === "profile_not_found") {
      setError("Impossible de charger votre profil. Veuillez réessayer ou contacter l'équipe Lead Factory.");
    }
    if (searchParams.get("reset") === "success") {
      setResetSuccess(true);
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError("Email ou mot de passe incorrect.");
      setLoading(false);
      return;
    }

    // Récupérer le rôle
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", data.user.id)
      .single();

    // Profil introuvable (timing RLS ou row pas encore créée) → on redirige quand même
    // Le layout côté serveur revalidera. Ne pas déconnecter l'utilisateur.
    if (!profile) {
      window.location.href = "/client/overview";
      return;
    }

    if (profile.is_active === false) {
      await supabase.auth.signOut();
      setError("Votre compte a été désactivé. Contactez un super admin Lead Factory.");
      setLoading(false);
      return;
    }

    // Track login (fire-and-forget — don't block redirect)
    fetch("/api/auth/track-login", { method: "POST" }).catch(() => {});

    // Hard redirect so the middleware sees fresh cookies on the next request
    window.location.href = profile.role === "admin" ? "/admin/dashboard" : "/client/overview";
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
          <div className="mb-6">
            <div className="sticker -rotate-1 inline-block mb-3">ESPACE PRIVÉ</div>
            <h1 className="text-2xl font-black uppercase tracking-tight">Connexion</h1>
            <p className="text-sm text-lf-gray font-medium mt-1">Accès réservé aux équipes Lead Factory et clients.</p>
          </div>

          {resetSuccess && (
            <div className="mb-5 flex items-center gap-3 p-4 bg-lf-green/30 border-3 border-black">
              <CheckCircle2 className="w-5 h-5 text-black flex-shrink-0" />
              <p className="text-sm font-bold">Mot de passe réinitialisé. Connecte-toi avec ton nouveau mot de passe.</p>
            </div>
          )}

          {error && (
            <div className="mb-5 flex items-center gap-3 p-4 bg-red-50 border-3 border-red-500">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-sm font-bold text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div>
              <label className="label-brutal">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@example.com"
                required
                className="input-brutal"
              />
            </div>

            <div>
              <label className="label-brutal">Mot de passe</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
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
              <div className="mt-2 text-right">
                <Link
                  href="/forgot-password"
                  className="text-xs font-black uppercase tracking-wider text-lf-gray hover:text-lf-blue transition-colors"
                >
                  Mot de passe oublié ?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`mt-2 flex items-center justify-center gap-2 text-sm py-4 ${loading ? "btn-disabled" : "btn-primary"}`}
            >
              {loading ? (
                <>
                  <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" />
                  Connexion...
                </>
              ) : (
                "SE CONNECTER"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-lf-gray mt-6 font-medium">
          Première connexion ? Votre accès est créé par l'équipe Lead Factory.
        </p>
      </div>
    </div>
  );
}
