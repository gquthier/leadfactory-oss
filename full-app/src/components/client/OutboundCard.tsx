import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import clsx from "clsx";

interface OutboundCardProps {
  href?: string;
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
  disabled?: boolean;
  cta?: string;
  iconColor?: "blue" | "yellow" | "green" | "black";
}

const ICON_BG: Record<NonNullable<OutboundCardProps["iconColor"]>, string> = {
  blue: "bg-lf-blue",
  yellow: "bg-lf-yellow",
  green: "bg-lf-green",
  black: "bg-lf-black",
};

const ICON_FG: Record<NonNullable<OutboundCardProps["iconColor"]>, string> = {
  blue: "text-white",
  yellow: "text-black",
  green: "text-white",
  black: "text-white",
};

export function OutboundCard({
  href,
  icon: Icon,
  title,
  description,
  badge,
  disabled = false,
  cta = "Démarrer",
  iconColor = "blue",
}: OutboundCardProps) {
  const isDisabled = disabled || !href;

  const cardClasses = clsx(
    "card-brutal p-6 flex flex-col gap-4 h-full group transition-all",
    isDisabled
      ? "opacity-50 cursor-not-allowed"
      : "hover:shadow-[10px_10px_0px_0px_#000] hover:-translate-y-1"
  );

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div
          className={clsx(
            "w-12 h-12 border-3 border-black rounded-xl flex items-center justify-center flex-shrink-0 shadow-brutal-xs",
            ICON_BG[iconColor]
          )}
        >
          <Icon className={clsx("w-6 h-6", ICON_FG[iconColor])} />
        </div>
        {badge && (
          <span className="text-[10px] font-black px-2 py-1 border-2 border-black bg-lf-yellow uppercase tracking-wider flex-shrink-0">
            {badge}
          </span>
        )}
      </div>

      <div className="flex-1 flex flex-col gap-2">
        <h3 className="text-lg font-black uppercase tracking-tight leading-tight">
          {title}
        </h3>
        <p className="text-sm font-medium text-lf-gray line-clamp-3">
          {description}
        </p>
      </div>

      <div className="flex items-center justify-between pt-2 border-t-3 border-black">
        <span className="font-black text-sm uppercase tracking-wide">
          {isDisabled ? "Bientôt disponible" : cta}
        </span>
        {!isDisabled && (
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
        )}
      </div>
    </>
  );

  if (isDisabled || !href) {
    return <div className={cardClasses}>{content}</div>;
  }

  return (
    <Link href={href} className={cardClasses}>
      {content}
    </Link>
  );
}
