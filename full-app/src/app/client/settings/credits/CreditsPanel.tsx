"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Coins, Loader2 } from "lucide-react";

const FEATURE_LABELS: Record<string, string> = {
  sales_analyze: "Analyse Sales Call",
  outbound_chat: "Outbound IA — chat",
  personal_brand_chat: "Personal Brand IA — chat",
  admin_grant: "Crédit attribué",
  admin_refund: "Remboursement",
};

interface CreditsData {
  balance: number;
  total_granted: number;
  total_consumed: number;
  last_consumed_at: string | null;
  costs: Record<string, number>;
  warning_threshold: number;
  low: boolean;
  empty: boolean;
  history: Array<{
    id: string;
    feature: string;
    amount: number; // positif = consommation, négatif = grant/refund
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
}

export function CreditsPanel() {
  const [data, setData] = useState<CreditsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/client/credits?history=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d as CreditsData | null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card-brutal p-8 flex items-center justify-center gap-2 bg-white">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm font-bold">Chargement…</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card-brutal p-6 bg-white">
        <p className="text-sm font-medium text-lf-gray">
          Impossible de charger ton solde de crédits. Recharge la page.
        </p>
      </div>
    );
  }

  const tone = data.empty
    ? "bg-lf-pink"
    : data.low
    ? "bg-lf-yellow"
    : "bg-white";

  return (
    <div className="flex flex-col gap-4">
      {/* Solde */}
      <div className={`card-brutal p-6 ${tone}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-lf-black text-white border-3 border-black flex items-center justify-center">
              {data.empty ? (
                <AlertTriangle className="w-6 h-6" />
              ) : (
                <Coins className="w-6 h-6" />
              )}
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray">
                Solde restant
              </p>
              <p className="text-4xl font-black leading-none">
                {data.balance.toLocaleString("fr-FR")}
              </p>
              <p className="text-xs font-medium text-lf-gray mt-1">
                Sur {data.total_granted.toLocaleString("fr-FR")} crédits offerts ·{" "}
                {data.total_consumed.toLocaleString("fr-FR")} consommés
              </p>
            </div>
          </div>

          {data.empty && (
            <div className="max-w-sm">
              <p className="text-xs font-black uppercase tracking-wider">
                Crédits épuisés
              </p>
              <p className="text-sm font-medium mt-1">
                Contacte ton interlocuteur Lead Factory pour recharger ton solde.
              </p>
            </div>
          )}
          {!data.empty && data.low && (
            <div className="max-w-sm">
              <p className="text-xs font-black uppercase tracking-wider">
                Solde faible
              </p>
              <p className="text-sm font-medium mt-1">
                Il te reste moins de {data.warning_threshold} crédits. Pense à
                contacter Lead Factory pour recharger.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Barème */}
      <div className="card-brutal p-5 bg-white">
        <p className="text-[10px] font-black uppercase tracking-wider text-lf-gray mb-3">
          Barème
        </p>
        <ul className="flex flex-col gap-2">
          {Object.entries(data.costs).map(([feature, cost]) => (
            <li
              key={feature}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="font-medium">
                {FEATURE_LABELS[feature] ?? feature}
              </span>
              <span className="font-black text-[10px] uppercase tracking-wider bg-lf-yellow border-2 border-black px-2 py-1">
                {cost} crédit{cost > 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Historique */}
      <div className="card-brutal p-0 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b-3 border-black bg-lf-black text-white">
          <p className="text-[10px] font-black uppercase tracking-wider">
            Historique d&apos;utilisation
          </p>
          <p className="text-sm font-black uppercase tracking-tight mt-0.5">
            {data.history.length} mouvement{data.history.length > 1 ? "s" : ""}
          </p>
        </div>
        {data.history.length === 0 ? (
          <p className="p-5 text-sm font-medium text-lf-gray italic">
            Pas encore d&apos;utilisation. Lance une analyse Sales, un chat Outbound ou un
            chat Personal Brand pour démarrer.
          </p>
        ) : (
          <ul className="divide-y-3 divide-black">
            {data.history.map((row) => {
              const isConsumption = row.amount > 0;
              return (
                <li
                  key={row.id}
                  className="px-5 py-3 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-black uppercase tracking-tight text-xs truncate">
                      {FEATURE_LABELS[row.feature] ?? row.feature}
                    </p>
                    <p className="text-[10px] font-medium text-lf-gray">
                      {new Date(row.created_at).toLocaleString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span
                    className={`font-black text-sm flex-shrink-0 ${
                      isConsumption ? "text-red-600" : "text-lf-green"
                    }`}
                  >
                    {isConsumption ? "−" : "+"}
                    {Math.abs(row.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
