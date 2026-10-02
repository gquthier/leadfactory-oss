"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Globe, Target, Lightbulb, ArrowRight, CheckCircle2, Building2 } from "lucide-react";

interface SignupOnboardingData {
  website: string;
  skipWebsite: boolean;
  objective: string;
  objectiveDetails: string;
  valueProposition: string;
  offer: string;
  target: string;
  logoUrl: string;
}

const DEFAULT_DATA: SignupOnboardingData = {
  website: "",
  skipWebsite: false,
  objective: "",
  objectiveDetails: "",
  valueProposition: "",
  offer: "",
  target: "",
  logoUrl: "",
};

const OBJECTIVE_OPTIONS = [
  "Leads",
  "Rendez-vous",
  "Ventes",
  "Ventes directes",
  "Trafic qualifié",
  "Autre",
];

function isValidWebsite(value: string) {
  if (!value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeWebsite(value: string) {
  const url = value.trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function readLogoAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Impossible de lire ce fichier"));
      }
    };
    reader.onerror = () => reject(new Error("Erreur de lecture du fichier"));
    reader.readAsDataURL(file);
  });
}

export function SignupOnboardingFlow() {
  const router = useRouter();
  const [data, setData] = useState<SignupOnboardingData>(DEFAULT_DATA);
  const [logoPreview, setLogoPreview] = useState("");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const steps = useMemo(() => {
    const baseSteps = ["website", "objective", "details"]; // details = optional
    if (data.skipWebsite) {
      baseSteps.push("proposition", "offer", "logo_target");
    }
    return baseSteps;
  }, [data.skipWebsite]);

  const isLastStep = step === steps.length - 1;

  const currentStep = steps[step];

  const canContinue = () => {
    if (currentStep === "website") {
      if (data.skipWebsite) return null;
      const normalized = normalizeWebsite(data.website);
      if (!normalized || !isValidWebsite(normalized)) {
        return "Tu dois renseigner un site web valide (ex: https://monsite.fr) ou activer le mode sans site.";
      }
      return null;
    }

    if (currentStep === "objective") {
      if (!data.objective.trim()) {
        return "Choisis un objectif pour démarrer.";
      }
      return null;
    }

    if (currentStep === "proposition") {
      if (!data.valueProposition.trim()) {
        return "Écris une proposition de valeur claire.";
      }
      return null;
    }

    if (currentStep === "offer") {
      if (!data.offer.trim()) {
        return "Décris ton offre.";
      }
      return null;
    }

    if (currentStep === "logo_target") {
      if (!data.target.trim()) {
        return "Décris ta cible.";
      }
      if (!data.logoUrl.trim() && !logoPreview) {
        return "Ajoute un logo (URL ou upload).";
      }
      return null;
    }

    return null;
  };

  const handleNext = () => {
    const validation = canContinue();
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);

    if (!isLastStep) {
      setStep((s) => s + 1);
      return;
    }

    handleSubmit();
  };

  const handleBack = () => {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    const payloadResponses: Record<string, unknown> = {
      website: data.skipWebsite ? null : normalizeWebsite(data.website),
      website_skipped: data.skipWebsite,
      objectif: data.objective,
      objectif_details: data.objectiveDetails.trim(),
      value_proposition: data.valueProposition,
      offer: data.offer,
      target: data.target,
      logo_url: data.logoUrl,
      logo_base64: logoPreview,
    };

    try {
      const res = await fetch("/api/onboarding/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: "signup",
          responses: payloadResponses,
        }),
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((result as { error?: string }).error || "L'enregistrement a échoué.");
      }

      const onboardingId =
        typeof (result as { onboardingId?: string }).onboardingId === "string"
          ? (result as { onboardingId: string }).onboardingId
          : null;

      if (!onboardingId) {
        throw new Error("Réponse inattendue du serveur.");
      }

      router.push(`/signup?onboarding_id=${encodeURIComponent(onboardingId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
      setLoading(false);
    }
  };

  const renderStep = () => {
    if (currentStep === "website") {
      return (
        <div className="space-y-5">
          <p className="text-xs uppercase font-black tracking-widest text-lf-gray mb-1">
            Étape 1 · 3–6
          </p>
          <h1 className="text-2xl font-black uppercase leading-tight">Insérez votre site web</h1>
          <p className="text-sm text-lf-gray font-medium">
            Si tu as déjà une vitrine, colle le lien de ton site. Sinon, passe cette question.
          </p>

          <div className="space-y-2">
            <label className="label-brutal">Adresse de votre site</label>
            <div className="relative">
              <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-lf-gray w-4 h-4" />
              <input
                value={data.website}
                onChange={(e) => setData({ ...data, website: e.target.value })}
                placeholder="https://monsite.fr"
                className="input-brutal pl-11"
                disabled={data.skipWebsite}
              />
            </div>
            <label className="label-brutal mt-3">Pas de site pour l&apos;instant</label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={data.skipWebsite}
                onChange={(e) => setData({ ...data, skipWebsite: e.target.checked })}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">Je n&apos;ai pas de site pour le moment</span>
            </label>
          </div>

          <p className="text-sm text-lf-gray font-medium">
            En mode sans site, on te posera quelques questions d&apos;enrichissement.
          </p>
        </div>
      );
    }

    if (currentStep === "objective") {
      return (
        <div className="space-y-5">
          <p className="text-xs uppercase font-black tracking-widest text-lf-gray mb-1">
            Étape {step + 1} · {steps.length}
          </p>
          <h1 className="text-2xl font-black uppercase leading-tight">Quel est votre objectif ?</h1>
          <div className="grid gap-2">
            {OBJECTIVE_OPTIONS.map((obj) => (
              <button
                type="button"
                key={obj}
                onClick={() => setData({ ...data, objective: obj })}
                className={`text-left border-3 border-black px-4 py-3 font-black uppercase tracking-wide text-sm transition-all ${
                  data.objective === obj
                    ? "bg-lf-blue text-white"
                    : "bg-white hover:bg-lf-yellow"
                }`}
              >
                {obj}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <label className="label-brutal">Détails (optionnel)</label>
            <textarea
              value={data.objectiveDetails}
              onChange={(e) => setData({ ...data, objectiveDetails: e.target.value })}
              placeholder="Ex: obtenir 10 rendez-vous par semaine"
              className="textarea-brutal min-h-[130px]"
            />
          </div>
        </div>
      );
    }

    if (currentStep === "details") {
      return (
        <div className="space-y-5">
          <p className="text-xs uppercase font-black tracking-widest text-lf-gray mb-1">
            Étape {step + 1} · {steps.length}
          </p>
          <h1 className="text-2xl font-black uppercase leading-tight">
            Y a t’il des détails sur votre cible ou offre que vous aimerez préciser ?
          </h1>
          <p className="text-sm text-lf-gray font-medium">
            Optionnel. Ces détails nous aident à calibrer l’analyse de départ.
          </p>
          <textarea
            value={data.target}
            onChange={(e) => setData({ ...data, target: e.target.value })}
            placeholder="Ex: Je cible les indépendants B2B entre 30 et 45 ans..."
            className="textarea-brutal min-h-[140px]"
          />
          <div className="text-sm text-lf-gray">
            <span className="font-black uppercase text-lf-black">Note :</span> si le champ « site web »
            n&apos;est pas rempli, l&apos;analyse proposera une suite de questions plus guidées.
          </div>
        </div>
      );
    }

    if (currentStep === "proposition") {
      return (
        <div className="space-y-5">
          <p className="text-xs uppercase font-black tracking-widest text-lf-gray mb-1">
            Étape {step + 1} · {steps.length}
          </p>
          <h1 className="text-2xl font-black uppercase leading-tight">Proposition de valeur</h1>
          <p className="text-sm text-lf-gray font-medium">
            Résume en une phrase ce que vous apportez à vos clients.
          </p>
          <div className="relative">
            <Lightbulb className="absolute left-4 top-4 text-lf-gray" />
            <textarea
              value={data.valueProposition}
              onChange={(e) => setData({ ...data, valueProposition: e.target.value })}
              placeholder="Ex: j’aide les consultants à transformer 3RD rdv en clients signés..."
              className="textarea-brutal pl-11 min-h-[140px]"
            />
          </div>
        </div>
      );
    }

    if (currentStep === "offer") {
      return (
        <div className="space-y-5">
          <p className="text-xs uppercase font-black tracking-widest text-lf-gray mb-1">
            Étape {step + 1} · {steps.length}
          </p>
          <h1 className="text-2xl font-black uppercase leading-tight">Votre offre</h1>
          <div className="relative">
            <Building2 className="absolute left-4 top-4 text-lf-gray" />
            <textarea
              value={data.offer}
              onChange={(e) => setData({ ...data, offer: e.target.value })}
              placeholder="Ex: accompagnement personnalisé, formation, audit, etc."
              className="textarea-brutal pl-11 min-h-[150px]"
            />
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <p className="text-xs uppercase font-black tracking-widest text-lf-gray mb-1">
          Étape {step + 1} · {steps.length}
        </p>
        <h1 className="text-2xl font-black uppercase leading-tight">Logo, cible, infos complémentaires</h1>
        <div className="space-y-2">
          <label className="label-brutal">Cible principale</label>
          <textarea
            value={data.target}
            onChange={(e) => setData({ ...data, target: e.target.value })}
            placeholder="Décris la cible exacte (âge, métier, douleur principale)"
            className="textarea-brutal min-h-[120px]"
          />
        </div>
        <div className="space-y-2">
          <label className="label-brutal">Logo (URL)</label>
          <input
            value={data.logoUrl}
            onChange={(e) => {
              setLogoPreview("");
              setData({ ...data, logoUrl: e.target.value });
            }}
            placeholder="https://.../logo.png"
            className="input-brutal"
          />
          <p className="text-sm text-lf-gray">ou</p>
          <label className="inline-flex items-center gap-3 text-sm font-black border-3 border-black px-4 py-3 bg-white hover:bg-lf-yellow cursor-pointer w-fit">
            <Upload className="w-4 h-4" />
            Uploader votre logo
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) {
                  setLogoPreview("");
                  return;
                }
                if (!file.type.startsWith("image/")) {
                  setError("Le fichier doit être une image.");
                  return;
                }
                if (file.size > 4 * 1024 * 1024) {
                  setError("Le logo ne doit pas dépasser 4 Mo.");
                  return;
                }
                const base64 = await readLogoAsBase64(file);
                setLogoPreview(base64);
                setData({ ...data, logoUrl: "" });
                setError(null);
              }}
            />
          </label>
          {logoPreview && (
            <div className="border-3 border-black bg-white p-3">
              <p className="text-xs uppercase font-black tracking-wider mb-2 text-lf-gray">Aperçu</p>
              <img src={logoPreview} alt="Aperçu du logo" className="max-h-20 w-auto object-contain" />
            </div>
          )}
          {data.logoUrl && !logoPreview ? (
            <p className="text-xs text-lf-gray">Aperçu : {data.logoUrl}</p>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-canvas grid-bg py-10 px-4">
      <div className="w-full max-w-2xl mx-auto card-brutal p-6 space-y-8">
        <div className="text-center space-y-2">
          <div className="sticker-yellow -rotate-1 inline-block">SE DÉMARRER</div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">Flow d&apos;onboarding</h1>
          <p className="text-sm text-lf-gray font-medium">
            Réponds vite pour passer à la création de ton compte.
          </p>
        </div>

        {renderStep()}

        {error && (
          <div className="p-4 bg-red-50 border-3 border-red-500 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          {step > 0 ? (
            <button
              type="button"
              onClick={handleBack}
              disabled={loading}
              className="text-sm py-3 px-4 border-3 border-black bg-white hover:bg-lf-yellow font-black uppercase tracking-wide"
            >
              Retour
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={handleNext}
            disabled={loading}
            className="flex items-center justify-center gap-2 text-sm py-3 px-6 border-3 border-black bg-black text-white hover:bg-lf-blue disabled:opacity-60 font-black uppercase tracking-wide"
          >
            {loading ? (
              "Enregistrement..."
            ) : isLastStep ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Commencer
              </>
            ) : (
              <>
                <ArrowRight className="w-4 h-4" />
                Continuer
              </>
            )}
            {loading ? <span className="animate-pulse">.</span> : null}
          </button>
        </div>

        {isLastStep && (
          <p className="text-center text-xs text-lf-gray">
            À la fin, tu seras redirigé vers la création de ton compte.
          </p>
        )}
      </div>
    </div>
  );
}
