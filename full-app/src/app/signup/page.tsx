"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff, UserRound, Zap, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

interface FinalizeResponse {
  onboarding_id?: string;
  error?: string;
}

function SignupContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const onboardingId = useMemo(() => searchParams.get("onboarding_id")?.trim() ?? "", [searchParams]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const passwordsMatch = password.length >= 8 && confirmPassword.length > 0 && password === confirmPassword;
  const validForm =
    onboardingId.length > 0 &&
    fullName.trim().length > 1 &&
    email.includes("@") &&
    password.length >= 8 &&
    passwordsMatch;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!validForm) {
      setError("Complete bien tous les champs obligatoires.");
      return;
    }

    if (!passwordsMatch) {
      setError("La confirmation du mot de passe ne correspond pas.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/onboarding/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onboarding_id: onboardingId,
          email,
          password,
          full_name: fullName,
        }),
      });

      const result = (await response.json().catch(() => null)) as FinalizeResponse | null;
      if (!response.ok || !result) {
        throw new Error(result?.error || "Impossible de finaliser l'inscription.");
      }

      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        throw new Error("Compte créé. Relance la connexion avec ton email + mot de passe.");
      }

      const nextUrl = new URL("/client-start", window.location.origin);
      nextUrl.searchParams.set("onboarding_id", result.onboarding_id || onboardingId);
      window.location.href = nextUrl.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'inscription.");
      setLoading(false);
    }
  };

  const goBackToOnboarding = () => {
    router.push("/onboarding");
  };

  if (!onboardingId) {
    return (
      <div className="min-h-screen bg-canvas grid-bg flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md card-brutal p-8">
          <h1 className="text-2xl font-black uppercase tracking-tight">Lien d'inscription invalide</h1>
          <p className="text-sm text-lf-gray font-medium mt-2">
            L&apos;onboarding n&apos;a pas été trouvé. Lance-le à nouveau pour reprendre depuis le départ.
          </p>
          <button
            onClick={goBackToOnboarding}
            type="button"
            className="mt-6 btn-primary w-full"
          >
            REPRENDRE L&apos;ONBOARDING
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas grid-bg flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md card-brutal p-8">
        <div className="mb-6 text-center">
          <div className="sticker-yellow inline-block -rotate-1 mb-3">FENÊTRE COMPTE</div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">
            Créer mon compte
          </h1>
          <p className="text-sm text-lf-gray font-medium mt-2">
            Pour lancer ton analyse, termine vite la création de ton espace.
          </p>
        </div>

        {error && (
          <div className="mb-5 flex items-start gap-3 p-4 bg-red-50 border-3 border-red-500">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-bold text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="label-brutal">Nom / Prénom</label>
            <div className="relative">
              <UserRound className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-lf-gray" />
              <input
                className="input-brutal pl-11"
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value);
                  setError(null);
                }}
                placeholder="Ex : Camille Martin"
                required
              />
            </div>
          </div>

          <div>
            <label className="label-brutal">Email</label>
            <input
              className="input-brutal"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
              placeholder="contact@example.com"
              required
            />
          </div>

          <div>
            <label className="label-brutal">Mot de passe</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="input-brutal pr-12"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
                placeholder="8 caractères minimum"
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lf-gray hover:text-black transition-colors"
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="label-brutal">Confirmer le mot de passe</label>
            <input
              className={`input-brutal ${confirmPassword.length > 0 && !passwordsMatch ? "border-red-500" : ""}`}
              type="password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setError(null);
              }}
              placeholder="Même mot de passe"
              required
              minLength={8}
            />
            {confirmPassword.length > 0 && !passwordsMatch ? (
              <p className="mt-2 text-sm font-bold text-red-700">Les mots de passe ne correspondent pas.</p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`mt-2 flex items-center justify-center gap-2 text-sm py-4 px-6 ${loading ? "btn-disabled" : "btn-primary"}`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Création en cours...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                TERMINER ET DEMARRER
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-lf-gray">
          En cliquant, tu valides la création de ton compte client.
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={(
        <div className="min-h-screen bg-canvas grid-bg flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" aria-label="Chargement" />
        </div>
      )}
    >
      <SignupContent />
    </Suspense>
  );
}
