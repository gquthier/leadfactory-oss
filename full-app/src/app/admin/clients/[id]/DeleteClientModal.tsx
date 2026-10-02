"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Download, AlertTriangle, X, Check } from "lucide-react";

interface Props {
  clientId: string;
  clientName: string;
}

export function DeleteClientModal({ clientId, clientName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const reset = () => {
    setOpen(false);
    setStep(1);
    setExported(false);
    setConfirmText("");
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/admin/export-client?client_id=${clientId}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "export.csv";
      a.click();
      URL.revokeObjectURL(url);
      setExported(true);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/delete-client", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      if (res.ok) {
        router.push("/admin/clients");
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => { setOpen(true); setStep(1); }}
        className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider border-3 border-black bg-white text-red-600 hover:bg-red-600 hover:text-white hover:shadow-brutal-sm transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Supprimer
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="card-brutal bg-white w-full max-w-md">

            {/* Step 1 — Warning + export option */}
            {step === 1 && (
              <>
                <div className="flex items-center justify-between px-6 py-4 border-b-3 border-black bg-red-600 text-white">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    <span className="font-black uppercase tracking-wider text-sm">Supprimer le client</span>
                  </div>
                  <button onClick={reset}><X className="w-5 h-5" /></button>
                </div>

                <div className="p-6 space-y-4">
                  <p className="font-bold text-sm">
                    Vous êtes sur le point de supprimer définitivement le client{" "}
                    <span className="font-black uppercase">{clientName}</span> ainsi que toutes ses données :
                  </p>
                  <ul className="text-sm font-medium space-y-1 pl-4 list-disc text-lf-gray">
                    <li>Profil et compte de connexion</li>
                    <li>Campagnes et historique</li>
                    <li>Leads collectés</li>
                    <li>Tâches et notes</li>
                  </ul>

                  <div className="bg-lf-yellow border-3 border-black p-4">
                    <p className="font-black text-sm uppercase mb-3">Exporter les données avant suppression</p>
                    <button
                      onClick={handleExport}
                      disabled={exporting}
                      className="flex items-center gap-2 w-full justify-center px-4 py-2.5 border-3 border-black bg-white font-black text-sm uppercase hover:bg-black hover:text-white transition-all disabled:opacity-50"
                    >
                      {exporting ? (
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                      ) : exported ? (
                        <Check className="w-4 h-4 text-lf-green" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      {exporting ? "Export en cours..." : exported ? "CSV exporté ✓" : "Exporter toutes les données (CSV)"}
                    </button>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={reset}
                      className="flex-1 px-4 py-2.5 border-3 border-black font-black text-sm uppercase hover:bg-gray-100 transition-colors"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={() => setStep(2)}
                      className="flex-1 px-4 py-2.5 border-3 border-black bg-red-600 text-white font-black text-sm uppercase hover:bg-red-700 transition-colors"
                    >
                      Continuer →
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Step 2 — Final confirmation */}
            {step === 2 && (
              <>
                <div className="flex items-center justify-between px-6 py-4 border-b-3 border-black bg-lf-black text-white">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                    <span className="font-black uppercase tracking-wider text-sm">Confirmation finale</span>
                  </div>
                  <button onClick={reset}><X className="w-5 h-5" /></button>
                </div>

                <div className="p-6 space-y-4">
                  <p className="font-bold text-sm">
                    Cette action est <span className="font-black text-red-600">irréversible</span>. Pour confirmer, tapez le nom du client :
                  </p>
                  <p className="font-black text-lg uppercase border-3 border-black px-3 py-2 bg-gray-50 text-center tracking-wider">
                    {clientName}
                  </p>
                  <input
                    type="text"
                    placeholder="Tapez le nom exact..."
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="input-brutal w-full"
                    autoFocus
                  />

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setStep(1)}
                      className="flex-1 px-4 py-2.5 border-3 border-black font-black text-sm uppercase hover:bg-gray-100 transition-colors"
                    >
                      ← Retour
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting || confirmText !== clientName}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-3 border-black bg-red-600 text-white font-black text-sm uppercase hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {deleting ? (
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      {deleting ? "Suppression..." : "Supprimer définitivement"}
                    </button>
                  </div>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </>
  );
}
