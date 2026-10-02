"use client";

import { CheckCircle2, FileText, PackageCheck, Sparkles } from "lucide-react";

interface AIDeliveryPanelProps {
  clientId: string;
  clientName: string;
}

const DELIVERY_ITEMS = [
  "Brief creatif",
  "Proposition commerciale",
  "Prompts publicitaires",
  "Assets IA",
];

export function AIDeliveryPanel({ clientId, clientName }: AIDeliveryPanelProps) {
  return (
    <div className="space-y-5">
      <div className="border-3 border-black bg-white p-5 shadow-brutal">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-lf-blue">
              Delivery IA
            </p>
            <h2 className="text-2xl font-black uppercase mt-1">{clientName}</h2>
            <p className="text-sm text-lf-gray mt-2">
              Centre de controle des livrables IA lies au client.
            </p>
          </div>
          <div className="w-11 h-11 border-2 border-black bg-lf-yellow flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {DELIVERY_ITEMS.map((item) => (
          <div key={item} className="border-3 border-black bg-white p-4 shadow-brutal-xs">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-black uppercase text-sm">{item}</p>
                <p className="text-xs text-lf-gray mt-1">Client ID: {clientId}</p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-lf-green" />
            </div>
          </div>
        ))}
      </div>

      <div className="border-3 border-black bg-canvas p-4">
        <div className="flex items-center gap-2">
          <PackageCheck className="w-5 h-5 text-lf-blue" />
          <p className="font-black uppercase text-sm">Workspace delivery</p>
        </div>
        <p className="text-sm text-lf-gray mt-2">
          Les modules Brief Creatif et Proposition restent les sources editables. Ce panneau centralise leur etat de livraison.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-xs font-black uppercase">
          <FileText className="w-4 h-4" />
          Livrables connectes
        </div>
      </div>
    </div>
  );
}
