"use client";

import Link from "next/link";
import { Linkedin, CheckCircle2, AlertTriangle } from "lucide-react";

export function LinkedInConnectionBadge({
  connected,
  fullName,
  profilePicture,
  refreshExpiresAt,
}: {
  connected: boolean;
  fullName?: string | null;
  profilePicture?: string | null;
  refreshExpiresAt?: string | null;
}) {
  const daysLeft = refreshExpiresAt
    ? Math.floor((new Date(refreshExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const warn = daysLeft !== null && daysLeft <= 30;

  if (!connected) {
    return (
      <Link
        href="/client/settings?tab=integrations"
        className="inline-flex items-center gap-2 px-3 py-2 border-3 border-red-500 bg-red-50 hover:bg-red-100 text-xs font-black uppercase tracking-wider text-red-700"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        LinkedIn non connecté — Connecter
      </Link>
    );
  }

  return (
    <Link
      href="/client/settings?tab=integrations"
      className={`inline-flex items-center gap-2 px-3 py-2 border-3 ${warn ? "border-lf-yellow bg-lf-yellow/20" : "border-lf-green bg-lf-green/10"}`}
    >
      {profilePicture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profilePicture}
          alt={fullName ?? "profil"}
          className="w-6 h-6 border-2 border-black object-cover"
        />
      ) : (
        <div className="w-6 h-6 bg-[#0A66C2] border-2 border-black flex items-center justify-center">
          <Linkedin className="w-3.5 h-3.5 text-white" />
        </div>
      )}
      <div className="flex flex-col items-start leading-tight">
        <span className="text-xs font-black flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          {fullName ? `Connecté · ${fullName}` : "Connecté"}
        </span>
        {warn && daysLeft !== null && (
          <span className="text-[10px] font-bold text-lf-gray">
            Reconnexion {daysLeft > 0 ? `dans ${daysLeft}j` : "requise"}
          </span>
        )}
      </div>
    </Link>
  );
}
