"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Zap, ChevronLeft, ChevronRight, Send, AlertCircle, Clock, RotateCcw } from "lucide-react";
import { OnboardingData, defaultOnboardingData } from "@/types/onboarding";
import { ProgressBar } from "./ProgressBar";
import { StepA } from "./steps/StepA";
import { StepB } from "./steps/StepB";
import { StepC } from "./steps/StepC";
import { StepD } from "./steps/StepD";
import { StepE } from "./steps/StepE";
import { StepF } from "./steps/StepF";
import { StepG } from "./steps/StepG";
import { StepH } from "./steps/StepH";
import { StepI } from "./steps/StepI";

const TOTAL_STEPS = 9;
const STORAGE_KEY = "lf-starter-onboarding-draft";
const MINUTES_PER_STEP = 2;

function validateStep(step: number, data: OnboardingData): string | null {
  switch (step) {
    case 0:
      if (!data.a_entreprise.trim()) return "Le nom de l'entreprise est requis.";
      if (!data.a_resume_offre.trim()) return "Le résumé de l'offre est requis.";
      if (!data.a_problemes.trim()) return "Les problèmes résolus sont requis.";
      return null;
    case 1:
      if (!data.b_objectif.length) return "Sélectionnez au moins un objectif.";
      if (!data.b_qualite_critere1.trim()) return "Le critère de qualité 1 est requis.";
      if (!data.b_kpi.length) return "Sélectionnez au moins un KPI.";
      return null;
    case 2:
      if (!data.c_promesse.trim()) return "La promesse principale est requise.";
      if (!data.c_nogo.trim()) return "Les no-go sont requis.";
      return null;
    case 3:
      if (!data.d_cible1_description.trim()) return "La description de la cible 1 est requise.";
      return null;
    case 6:
      if (!data.g_budget.trim() || !Number.isFinite(Number(data.g_budget)) || Number(data.g_budget) < 0) return "Le budget mensuel est requis.";
      return null;
    case 8: {
      if (!data.i_email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.i_email)) {
        return "Un email valide est requis.";
      }
      return null;
    }
    default:
      return null;
  }
}

/** Check if form data differs from default (i.e. user has filled something) */
function hasData(data: OnboardingData): boolean {
  return (
    data.a_entreprise.trim() !== "" ||
    data.a_resume_offre.trim() !== "" ||
    data.b_objectif.length > 0 ||
    data.c_promesse.trim() !== "" ||
    data.d_cible1_description.trim() !== ""
  );
}

export function OnboardingForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingData>(defaultOnboardingData);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  // Touch tracking for swipe navigation
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // ── 1. Load from localStorage on mount ──────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { step?: number; data?: OnboardingData };
        if (parsed.data) {
          setData({ ...defaultOnboardingData, ...parsed.data });
          if (typeof parsed.step === "number") setStep(parsed.step);
          setDraftRestored(true);
        }
      }
    } catch {
      // silently ignore corrupt storage
    }
  }, []);

  // ── 2. Auto-save to localStorage on every change ─────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, data: {...data,i_password:'',i_password_confirm:''} }));
    } catch {
      // silently ignore quota errors
    }
  }, [step, data]);

  // ── 3. Warn before leaving if data is filled ─────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasData(data)) {
        e.preventDefault();
        e.returnValue = "Vous avez des données non envoyées. Quitter la page ?";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [data]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleChange = useCallback((patch: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...patch }));
    if (error) setError(null);
  }, [error]);

  const goToStep = useCallback((target: number) => {
    setError(null);
    setStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleNext = () => {
    const validationError = validateStep(step, data);
    if (validationError) {
      setError(validationError);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setError(null);
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePrev = () => {
    setError(null);
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: data }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Erreur serveur");
      }

      const result=await res.json();
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      router.push('/onboarding/merci'+(result.agent_error?'?agents=failed':result.agent_job_id?'?agents=started':''));
    } catch (err) {
      console.error(err);
      setError("Une erreur est survenue lors de l'envoi. Veuillez réessayer.");
      setLoading(false);
    }
  };

  // ── 4. Swipe navigation (mobile touch events) ─────────────────────────────
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    // Only process mostly-horizontal swipes (> 60px horizontal, < 80px vertical)
    if (Math.abs(dx) > 60 && Math.abs(dy) < 80) {
      if (dx < 0 && step < TOTAL_STEPS - 1) {
        // Swipe left → next
        handleNext();
      } else if (dx > 0 && step > 0) {
        // Swipe right → prev
        handlePrev();
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const stepsRemaining = TOTAL_STEPS - 1 - step; // steps left after current
  const minutesRemaining = stepsRemaining * MINUTES_PER_STEP;

  const steps = [StepA, StepB, StepC, StepD, StepE, StepF, StepG, StepH, StepI];
  const CurrentStep = steps[step];

  return (
    <div className="min-h-screen bg-canvas">
      {/* Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-canvas border-b-3 border-black">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <a href="/admin/dashboard" className="flex items-center gap-3" target="_blank" rel="noopener noreferrer">
            <div className="w-8 h-8 bg-lf-blue border-3 border-black rounded-full flex items-center justify-center shadow-brutal-xs">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-black uppercase tracking-tight">LeadFactory</span>
          </a>
          <div className="flex items-center gap-3">
            {/* Draft restored badge */}
            {draftRestored && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-lf-yellow border-3 border-black shadow-brutal-xs">
                <RotateCcw className="w-3 h-3" />
                <span className="text-[10px] font-black uppercase tracking-wider">Brouillon restauré</span>
              </div>
            )}
            <span className="sticker -rotate-2 text-xs hidden sm:inline-block">
              ONBOARDING
            </span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main
        className="pt-24 pb-32 px-4 sm:px-6"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="max-w-4xl mx-auto">

          {/* Hero intro (step 0 only) */}
          {step === 0 && (
            <div className="mb-10 animate-fade-in-up">
              <div className="sticker-yellow -rotate-1 inline-block mb-4">
                BIENVENUE
              </div>
              <h1 className="text-4xl sm:text-5xl font-black leading-tight tracking-tight mb-4">
                Configurons ensemble<br />
                <span className="text-lf-blue italic">votre campagne Meta.</span>
              </h1>
              <p className="text-lg font-medium text-lf-gray max-w-2xl">
                Ce questionnaire prend environ <strong className="text-black">10-15 minutes</strong>.
                Il nous permettra de créer des campagnes publicitaires parfaitement adaptées à votre offre et à vos cibles.
              </p>
            </div>
          )}

          {/* Progress */}
          <div className="mb-8">
            <ProgressBar
              currentStep={step}
              onNavigate={(target) => goToStep(target)}
            />
          </div>

          {/* Time remaining indicator */}
          {stepsRemaining > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-3.5 h-3.5 text-lf-gray flex-shrink-0" />
              <p className="text-xs font-bold text-lf-gray uppercase tracking-wider">
                Environ {minutesRemaining} minute{minutesRemaining > 1 ? "s" : ""} restante{minutesRemaining > 1 ? "s" : ""}
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border-3 border-red-500 shadow-brutal-sm">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="font-bold text-red-700 text-sm">{error}</p>
            </div>
          )}

          {/* Step content */}
          <div className="card-brutal p-6 sm:p-10 animate-fade-in-up">
            <CurrentStep data={data} onChange={handleChange} />
          </div>

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between gap-4">
            {step > 0 ? (
              <button
                type="button"
                onClick={handlePrev}
                className="btn-secondary flex items-center gap-2 text-sm px-6 py-3"
              >
                <ChevronLeft className="w-4 h-4" />
                Précédent
              </button>
            ) : (
              <div />
            )}

            {step < TOTAL_STEPS - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                className="btn-primary flex items-center gap-2 text-sm px-8 py-3"
              >
                Suivant
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className={`flex items-center gap-2 text-sm px-8 py-3 ${
                  loading ? "btn-disabled" : "btn-blue"
                }`}
              >
                {loading ? (
                  <>
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    Envoi en cours...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Envoyer le questionnaire
                  </>
                )}
              </button>
            )}
          </div>

          {/* Mobile hint */}
          <p className="text-center text-xs font-medium text-lf-gray mt-4">
            {stepsRemaining > 0
              ? "Glissez gauche/droite pour naviguer · Brouillon sauvegardé automatiquement"
              : "Brouillon sauvegardé automatiquement."}
          </p>
        </div>
      </main>
    </div>
  );
}
