"use client";

import { Sparkles } from "lucide-react";

export function BestTimeHintSlot({
  isSweet,
  isMild,
  onClick,
}: {
  isSweet: boolean;
  isMild: boolean;
  onClick: () => void;
}) {
  if (!isSweet && !isMild) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full h-full min-h-[44px] hover:bg-lf-yellow/10 transition-colors"
        aria-label="Programmer un post à ce créneau"
      />
    );
  }

  const sweetClasses =
    "border-2 border-dashed border-lf-yellow bg-lf-yellow/10 hover:bg-lf-yellow/30 hover:border-solid";
  const mildClasses =
    "border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100";

  return (
    <button
      type="button"
      onClick={onClick}
      title={isSweet ? "Sweet spot LinkedIn — engagement maximisé" : "Créneau correct"}
      className={`w-full h-full min-h-[44px] flex items-center justify-center gap-1 transition-all ${isSweet ? sweetClasses : mildClasses}`}
    >
      {isSweet && (
        <>
          <Sparkles className="w-3 h-3 text-lf-yellow" />
          <span className="text-[9px] font-black uppercase tracking-wider text-lf-gray">
            sweet
          </span>
        </>
      )}
    </button>
  );
}
