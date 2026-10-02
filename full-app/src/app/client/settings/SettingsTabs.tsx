"use client";

import Link from "next/link";
import { User, Plug, ClipboardList, Coins } from "lucide-react";

interface Props {
  active: "profile" | "integrations" | "brief" | "credits";
}

const TABS = [
  { key: "profile" as const, label: "Profil", icon: User, href: "/client/settings?tab=profile" },
  {
    key: "integrations" as const,
    label: "Intégrations",
    icon: Plug,
    href: "/client/settings?tab=integrations",
  },
  {
    key: "brief" as const,
    label: "Mon brief",
    icon: ClipboardList,
    href: "/client/settings?tab=brief",
    badge: "Nouveau",
  },
  {
    key: "credits" as const,
    label: "Crédits",
    icon: Coins,
    href: "/client/settings?tab=credits",
    badge: "Nouveau",
  },
];

export function SettingsTabs({ active }: Props) {
  return (
    <div className="flex border-b-3 border-black overflow-x-auto">
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-black uppercase tracking-wider border-3 -mb-[3px] transition-all ${
              isActive
                ? "border-black border-b-canvas bg-canvas text-black"
                : "border-transparent text-lf-gray hover:text-black hover:bg-lf-yellow/30"
            }`}
          >
            <Icon className="w-4 h-4" />
            {t.label}
            {t.badge && (
              <span className="text-[10px] font-black px-1.5 py-0.5 bg-lf-yellow text-black border-2 border-black">
                {t.badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
