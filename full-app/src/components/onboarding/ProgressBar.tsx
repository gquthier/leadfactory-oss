"use client";

import { useState } from "react";

const STEPS = [
  { letter: "A", label: "Entreprise" },
  { letter: "B", label: "Objectifs" },
  { letter: "C", label: "Message" },
  { letter: "D", label: "Ciblage" },
  { letter: "E", label: "Parcours" },
  { letter: "F", label: "Tracking" },
  { letter: "G", label: "Budget" },
  { letter: "H", label: "Assets" },
  { letter: "I", label: "Contact" },
];

interface ProgressBarProps {
  currentStep: number; // 0-indexed
  onNavigate?: (step: number) => void; // navigate to previous steps
}

export function ProgressBar({ currentStep, onNavigate }: ProgressBarProps) {
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);
  const pct = Math.round(((currentStep + 1) / STEPS.length) * 100);

  return (
    <div className="w-full">
      {/* Step indicators */}
      <div className="flex items-stretch border-3 border-black">
        {STEPS.map((step, i) => {
          const isDone = i < currentStep;
          const isCurrent = i === currentStep;
          const isNavigable = isDone && onNavigate;
          const isHovered = hoveredStep === i;

          return (
            <div
              key={step.letter}
              className={`flex-1 flex flex-col items-center justify-center py-3 border-r-3 border-black last:border-r-0 transition-colors duration-200 relative ${
                isNavigable ? "cursor-pointer" : "cursor-default"
              } ${
                isCurrent
                  ? "bg-lf-black text-white"
                  : isDone
                  ? isHovered
                    ? "bg-lf-blue/80 text-white"
                    : "bg-lf-blue text-white"
                  : "bg-white text-lf-gray"
              }`}
              onClick={() => {
                if (isNavigable) onNavigate(i);
              }}
              onMouseEnter={() => setHoveredStep(i)}
              onMouseLeave={() => setHoveredStep(null)}
              title={`${step.letter} : ${step.label}`}
            >
              <span className={`text-lg font-black leading-none ${isCurrent || isDone ? "" : "opacity-50"}`}>
                {step.letter}
              </span>
              <span className="hidden sm:block text-[10px] font-bold uppercase tracking-wider mt-1 opacity-80">
                {step.label}
              </span>

              {/* Hover tooltip for completed steps on mobile */}
              {isHovered && isDone && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 pointer-events-none">
                  <div className="bg-black text-white text-[10px] font-black uppercase tracking-wider px-2 py-1 whitespace-nowrap border-2 border-black shadow-brutal-xs">
                    {step.letter} : {step.label}
                    {isNavigable && (
                      <span className="block text-lf-yellow text-[9px] mt-0.5 text-center">
                        CLIQUER POUR REVENIR
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-white border-x-3 border-b-3 border-black">
        <div
          className="h-full bg-lf-blue transition-all duration-500 ease-in-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Status line */}
      <div className="flex items-center justify-between mt-1 px-1">
        <p className="text-xs font-bold text-lf-gray">
          Étape {currentStep + 1} / {STEPS.length}
        </p>
        <p className="text-xs font-black text-lf-blue uppercase tracking-wider">
          {pct}% COMPLÉTÉ
        </p>
      </div>
    </div>
  );
}
