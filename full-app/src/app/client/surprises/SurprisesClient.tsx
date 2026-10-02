"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Loader2, Linkedin, Mail, Phone, X, Download, Copy, Check, AlertTriangle, Calendar } from "lucide-react";
import { SchedulePostSheet } from "@/components/client/SchedulePostSheet";

export interface SurpriseAsset {
  id: string;
  surprise_id: string;
  client_id: string;
  asset_type: "linkedin_post" | "cold_email_sequence" | "call_script";
  order_index: number;
  title: string;
  body: string;
  hook: string | null;
  framework: string | null;
  angle: string | null;
  payload: Record<string, unknown>;
  model_used: string | null;
  created_at: string;
}

interface Props {
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  assets: SurpriseAsset[];
}

export function SurprisesClient({ status, startedAt, finishedAt, errorMessage, assets }: Props) {
  const router = useRouter();
  const [openAsset, setOpenAsset] = useState<SurpriseAsset | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Auto-refresh while generating
  useEffect(() => {
    if (status !== "generating" && status !== "pending") return;
    const interval = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(interval);
  }, [status, router]);

  const linkedinPosts = assets.filter((a) => a.asset_type === "linkedin_post");
  const emailSequences = assets.filter((a) => a.asset_type === "cold_email_sequence");
  const callScripts = assets.filter((a) => a.asset_type === "call_script");

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  if (status === "pending" || status === "generating") {
    const elapsedMs = startedAt ? Date.now() - new Date(startedAt).getTime() : 0;
    const elapsedMin = Math.floor(elapsedMs / 60000);
    const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
    return (
      <div className="p-6 lg:p-8 max-w-4xl">
        <div className="mb-8">
          <div className="sticker-yellow -rotate-1 inline-block mb-3">SURPRISES</div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Tes surprises sont en route 🎁</h1>
          <p className="text-lf-gray font-medium mt-2">On génère 10 posts LinkedIn, 2 séquences cold email, et 1 script de call sur-mesure pour toi.</p>
        </div>

        <div className="border-3 border-black p-8 bg-canvas shadow-brutal">
          <div className="flex items-center gap-4 mb-6">
            <Loader2 className="w-8 h-8 animate-spin text-lf-blue" />
            <div>
              <div className="font-black text-xl uppercase">Génération en cours…</div>
              <div className="text-sm text-lf-gray mt-1">
                {startedAt ? `Démarré il y a ${elapsedMin}m ${elapsedSec}s` : "Démarrage…"}
              </div>
            </div>
          </div>
          <div className="w-full h-3 bg-white border-2 border-black overflow-hidden">
            <div className="h-full bg-lf-blue animate-pulse" style={{ width: "60%" }} />
          </div>
          <p className="mt-6 text-sm font-medium">
            Tes surprises seront prêtes dans <strong>5 à 10 minutes</strong>. Tu peux fermer cette page, on t'enverra un email quand c'est prêt.
          </p>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="p-6 lg:p-8 max-w-4xl">
        <div className="mb-8">
          <div className="sticker-yellow -rotate-1 inline-block mb-3">SURPRISES</div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Génération échouée</h1>
        </div>
        <div className="border-3 border-red-400 bg-red-50 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
            <div>
              <div className="font-black text-red-700 mb-2">Quelque chose s'est mal passé</div>
              <div className="text-sm">{errorMessage ?? "Erreur inconnue"}</div>
              <p className="text-sm mt-3">Contacte le support LeadFactory pour qu'on relance la génération.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      <div className="mb-8">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">SURPRISES</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Tes surprises sont prêtes 🎁</h1>
        <p className="text-lf-gray font-medium mt-2">
          {finishedAt && `Généré le ${new Date(finishedAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}`} —
          {assets.length} assets sur-mesure prêts à utiliser.
        </p>
      </div>

      {/* Section 1: LinkedIn posts */}
      {linkedinPosts.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <Linkedin className="w-6 h-6" />
            <h2 className="text-2xl font-black uppercase">Posts LinkedIn</h2>
            <span className="text-xs font-black bg-lf-blue text-white px-2 py-1 border-2 border-black">
              {linkedinPosts.length}
            </span>
          </div>
          <div className="overflow-x-auto -mx-6 px-6 pb-2">
            <div className="flex gap-4" style={{ width: "max-content" }}>
              {linkedinPosts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setOpenAsset(p)}
                  className="w-80 flex-shrink-0 border-3 border-black bg-white shadow-brutal p-4 text-left hover:bg-lf-yellow/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-black bg-black text-white px-2 py-1 uppercase">
                      {p.framework ?? "Post"}
                    </span>
                    <span className="text-[10px] text-lf-gray">#{p.order_index + 1}</span>
                  </div>
                  <div className="font-black text-sm mb-2 line-clamp-2">{p.hook ?? p.title}</div>
                  <div className="text-xs text-lf-gray line-clamp-4 whitespace-pre-wrap">{p.body.slice(0, 200)}…</div>
                  <div className="mt-3 text-[10px] text-lf-gray uppercase font-bold">Cliquer pour ouvrir</div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Section 2: Cold email sequences */}
      {emailSequences.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <Mail className="w-6 h-6" />
            <h2 className="text-2xl font-black uppercase">Séquences cold email</h2>
            <span className="text-xs font-black bg-lf-green text-white px-2 py-1 border-2 border-black">
              {emailSequences.length}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {emailSequences.map((e) => {
              const emails = (e.payload?.emails as Array<{ step: string; subject: string }> | undefined) ?? [];
              return (
                <button
                  key={e.id}
                  onClick={() => setOpenAsset(e)}
                  className="border-3 border-black bg-white shadow-brutal p-5 text-left hover:bg-lf-green/20 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-black bg-lf-green text-white px-2 py-1 uppercase">
                      Séquence
                    </span>
                    <span className="text-[10px] text-lf-gray uppercase">{emails.length} emails</span>
                  </div>
                  <div className="font-black text-lg mb-2">{e.title}</div>
                  {e.angle && <div className="text-xs text-lf-gray mb-3">{e.angle}</div>}
                  <div className="space-y-1">
                    {emails.slice(0, 3).map((em, i) => (
                      <div key={i} className="text-xs flex gap-2">
                        <span className="font-bold flex-shrink-0">{em.step}:</span>
                        <span className="line-clamp-1">{em.subject}</span>
                      </div>
                    ))}
                    {emails.length > 3 && <div className="text-xs text-lf-gray italic">+{emails.length - 3} autres…</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 3: Call scripts */}
      {callScripts.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <Phone className="w-6 h-6" />
            <h2 className="text-2xl font-black uppercase">Script de cold call</h2>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {callScripts.map((s) => (
              <button
                key={s.id}
                onClick={() => setOpenAsset(s)}
                className="border-3 border-black bg-white shadow-brutal p-5 text-left hover:bg-lf-yellow/30 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-black bg-lf-yellow text-black px-2 py-1 uppercase border-2 border-black">
                    Script
                  </span>
                </div>
                <div className="font-black text-lg mb-2">{s.title}</div>
                <div className="text-sm text-lf-gray">
                  Ouverture · raison d'appel · qualification · pitch · objections · CTA
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Modal */}
      {openAsset && <AssetModal asset={openAsset} onClose={() => setOpenAsset(null)} onCopy={copyToClipboard} copied={copied} />}
    </div>
  );
}

function AssetModal({
  asset,
  onClose,
  onCopy,
  copied,
}: {
  asset: SurpriseAsset;
  onClose: () => void;
  onCopy: (text: string, id: string) => void;
  copied: string | null;
}) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const canSchedule = asset.asset_type === "linkedin_post";

  function downloadText(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white border-3 border-black shadow-brutal max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b-3 border-black bg-canvas">
          <div className="font-black text-lg truncate">{asset.title}</div>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 border-2 border-black">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {asset.asset_type === "linkedin_post" && (
            <div className="space-y-4">
              {asset.framework && (
                <div className="inline-block text-xs font-black bg-black text-white px-2 py-1 uppercase">
                  Framework : {asset.framework}
                </div>
              )}
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed border-2 border-black p-4 bg-canvas">
                {asset.body}
              </pre>
            </div>
          )}
          {asset.asset_type === "cold_email_sequence" && (
            <div className="space-y-4">
              {asset.angle && <div className="text-sm italic text-lf-gray">{asset.angle}</div>}
              {((asset.payload?.emails as Array<{ step: string; subject: string; body: string; wait_days: number }>) ?? []).map((em, i) => (
                <div key={i} className="border-2 border-black p-4 bg-canvas">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-black text-sm">{em.step}</div>
                    <button
                      onClick={() => onCopy(`Subject: ${em.subject}\n\n${em.body}`, `${asset.id}-${i}`)}
                      className="text-xs flex items-center gap-1 px-2 py-1 border-2 border-black bg-white hover:bg-lf-yellow"
                    >
                      {copied === `${asset.id}-${i}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied === `${asset.id}-${i}` ? "Copié" : "Copier"}
                    </button>
                  </div>
                  <div className="text-xs font-bold mb-1">Subject: {em.subject}</div>
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{em.body}</pre>
                </div>
              ))}
            </div>
          )}
          {asset.asset_type === "call_script" && (
            <div className="space-y-4">
              {Object.entries(asset.payload as Record<string, unknown>).map(([k, v]) => {
                if (k === "name") return null;
                if (k === "qualification_questions" && Array.isArray(v)) {
                  return (
                    <div key={k} className="border-2 border-black p-4 bg-canvas">
                      <div className="font-black text-sm uppercase mb-2">Questions de qualification</div>
                      <ol className="list-decimal list-inside text-sm space-y-1">
                        {(v as string[]).map((q, i) => <li key={i}>{q}</li>)}
                      </ol>
                    </div>
                  );
                }
                if (k === "objections" && Array.isArray(v)) {
                  return (
                    <div key={k} className="border-2 border-black p-4 bg-canvas">
                      <div className="font-black text-sm uppercase mb-2">Objections + réponses</div>
                      <div className="space-y-3">
                        {(v as Array<{ objection: string; response: string }>).map((o, i) => (
                          <div key={i}>
                            <div className="text-sm font-bold">↳ {o.objection}</div>
                            <div className="text-sm text-lf-gray ml-4 mt-1">{o.response}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                if (typeof v === "string") {
                  return (
                    <div key={k} className="border-2 border-black p-4 bg-canvas">
                      <div className="font-black text-sm uppercase mb-2">{k.replace(/_/g, " ")}</div>
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{v}</pre>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}
        </div>
        <div className="border-t-3 border-black p-4 flex flex-wrap gap-2 bg-canvas">
          <button
            onClick={() => onCopy(asset.body, asset.id)}
            className="flex-1 min-w-[140px] flex items-center justify-center gap-2 px-4 py-2 border-3 border-black bg-white hover:bg-lf-yellow font-bold uppercase text-sm"
          >
            {copied === asset.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied === asset.id ? "Copié" : "Copier"}
          </button>
          <button
            onClick={() =>
              downloadText(
                `${asset.asset_type}-${asset.order_index + 1}.txt`,
                asset.asset_type === "cold_email_sequence" || asset.asset_type === "call_script"
                  ? JSON.stringify(asset.payload, null, 2)
                  : asset.body,
              )
            }
            className="flex items-center justify-center gap-2 px-4 py-2 border-3 border-black bg-white text-black hover:bg-lf-yellow font-bold uppercase text-sm"
          >
            <Download className="w-4 h-4" />
            Télécharger
          </button>
          {canSchedule && (
            <button
              onClick={() => setScheduleOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 border-3 border-black bg-lf-blue text-white hover:bg-lf-blue/90 font-bold uppercase text-sm"
            >
              <Calendar className="w-4 h-4" />
              Programmer
            </button>
          )}
        </div>
      </div>
      {canSchedule && (
        <SchedulePostSheet
          open={scheduleOpen}
          onClose={() => setScheduleOpen(false)}
          postBody={asset.body}
          sourceType="surprise_asset"
          sourceId={asset.id}
        />
      )}
    </div>
  );
}
