"use client";

import { useMemo, useState } from "react";
import { Search, Webhook, Sparkles, Loader2, Copy, Check, Download, ExternalLink, AlertTriangle, KeyRound } from "lucide-react";

export interface ClientRow {
  id: string;
  full_name: string | null;
  email: string | null;
  company: string | null;
  is_active: boolean | null;
  created_at: string;
  keys: Array<{
    id: string;
    label: string;
    key_prefix: string;
    provider: string;
    last_used_at: string | null;
    created_at: string;
  }>;
}

interface ProvisionedReveal {
  client_id: string;
  full_key: string;
  webhook_url: string;
  blueprint: unknown;
}

export function WebhooksAdminClient({ initialClients }: { initialClients: ClientRow[] }) {
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<ProvisionedReveal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientRow[]>(initialClients);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      [c.full_name, c.email, c.company]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [clients, search]);

  async function provision(client: ClientRow) {
    setBusyId(client.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/clients/${client.id}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Make · Meta Lead Ads", provider: "make" }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ProvisionedReveal> & { error?: string; key?: ClientRow["keys"][number] };
      if (!res.ok || !data.full_key || !data.webhook_url || !data.blueprint) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setReveal({
        client_id: client.id,
        full_key: data.full_key,
        webhook_url: data.webhook_url,
        blueprint: data.blueprint,
      });
      // Optimistic update of the local list of keys (without the secret).
      if (data.key) {
        setClients((prev) =>
          prev.map((c) =>
            c.id === client.id
              ? { ...c, keys: [{ ...data.key!, provider: data.key!.provider ?? "make" }, ...c.keys] }
              : c
          )
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusyId(null);
    }
  }

  function copy(text: string, slot: string) {
    navigator.clipboard.writeText(text);
    setCopied(slot);
    setTimeout(() => setCopied(null), 1500);
  }

  function downloadBlueprint(client: ClientRow, blueprint: unknown) {
    const slug = (client.company || client.full_name || client.email || "client")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const filename = `leadfactory-meta-${slug}.json`;
    const blob = new Blob([JSON.stringify(blueprint, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-lf-gray" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Chercher un client (nom, email, société)…"
            className="w-full pl-10 pr-3 py-2 border-3 border-black font-medium"
          />
        </div>
        <div className="text-xs font-black uppercase text-lf-gray">
          {filtered.length} client{filtered.length > 1 ? "s" : ""}
        </div>
      </div>

      {error && (
        <div className="border-3 border-red-400 bg-red-50 text-red-700 px-3 py-2 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="font-medium text-sm">{error}</span>
        </div>
      )}

      <div className="border-3 border-black overflow-hidden">
        <table className="w-full bg-white">
          <thead>
            <tr className="bg-canvas border-b-3 border-black text-left">
              <th className="px-4 py-3 text-xs font-black uppercase tracking-wider">Client</th>
              <th className="px-4 py-3 text-xs font-black uppercase tracking-wider">Clés actives</th>
              <th className="px-4 py-3 text-xs font-black uppercase tracking-wider text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-lf-gray">
                  Aucun client ne correspond.
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="border-t-2 border-black/20 hover:bg-canvas/50">
                  <td className="px-4 py-3 align-top">
                    <div className="font-black text-sm">
                      {c.company || c.full_name || "—"}
                    </div>
                    <div className="text-xs text-lf-gray">
                      {c.full_name && c.company ? `${c.full_name} · ` : ""}
                      {c.email ?? "—"}
                    </div>
                    {c.is_active === false && (
                      <span className="inline-block mt-1 text-[10px] font-black uppercase tracking-wider text-red-600 border border-red-400 px-1.5 py-0.5">
                        Désactivé
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {c.keys.length === 0 ? (
                      <span className="text-xs text-lf-gray italic">Aucune</span>
                    ) : (
                      <div className="space-y-1">
                        {c.keys.slice(0, 4).map((k) => (
                          <div
                            key={k.id}
                            className="text-[11px] font-medium flex items-center gap-2"
                          >
                            <KeyRound className="w-3 h-3 text-lf-gray flex-shrink-0" />
                            <code className="bg-canvas border border-black/20 px-1 py-0.5 text-[10px]">
                              {k.key_prefix}
                            </code>
                            <span className="text-lf-gray">{k.label}</span>
                          </div>
                        ))}
                        {c.keys.length > 4 && (
                          <div className="text-[10px] text-lf-gray italic">
                            +{c.keys.length - 4} autres
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <button
                      onClick={() => provision(c)}
                      disabled={busyId === c.id}
                      className="inline-flex items-center gap-2 px-3 py-2 border-3 border-black bg-lf-black text-white hover:bg-lf-blue hover:shadow-[3px_3px_0_#000] font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50"
                    >
                      {busyId === c.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      Provisionner Make
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {reveal && (
        <RevealModal
          reveal={reveal}
          onClose={() => setReveal(null)}
          onCopy={copy}
          copiedSlot={copied}
          onDownload={() => {
            const client = clients.find((c) => c.id === reveal.client_id);
            if (client) downloadBlueprint(client, reveal.blueprint);
          }}
        />
      )}
    </div>
  );
}

function RevealModal({
  reveal,
  onClose,
  onCopy,
  copiedSlot,
  onDownload,
}: {
  reveal: ProvisionedReveal;
  onClose: () => void;
  onCopy: (text: string, slot: string) => void;
  copiedSlot: string | null;
  onDownload: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border-3 border-black shadow-brutal max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b-3 border-black bg-lf-yellow">
          <div className="flex items-center gap-2">
            <Webhook className="w-5 h-5" />
            <h2 className="text-lg font-black uppercase tracking-tight">
              Webhook provisionné
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 border-2 border-black hover:bg-white"
            aria-label="Fermer"
          >
            <span className="font-black px-1">×</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="border-3 border-red-400 bg-red-50 p-3 text-sm">
            <p className="font-black uppercase text-xs mb-1 text-red-700">
              ⚠ À sauvegarder maintenant
            </p>
            <p className="text-red-700">
              La clé complète n&apos;est affichée qu&apos;une seule fois. Téléchargez le
              blueprint maintenant, ou copiez la clé pour la stocker en sécurité.
              Si vous la perdez, il faudra en créer une nouvelle.
            </p>
          </div>

          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">
              URL webhook (contient la clé)
            </p>
            <div className="flex gap-2 items-stretch">
              <code className="flex-1 border-2 border-black bg-canvas px-3 py-2 text-xs font-mono break-all">
                {reveal.webhook_url}
              </code>
              <button
                onClick={() => onCopy(reveal.webhook_url, "url")}
                className="px-3 py-2 border-2 border-black bg-white hover:bg-lf-yellow font-bold text-xs uppercase flex items-center gap-1"
              >
                {copiedSlot === "url" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedSlot === "url" ? "Copié" : "Copier"}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-black uppercase tracking-wider text-lf-gray mb-1">
              Clé complète (token brut)
            </p>
            <div className="flex gap-2 items-stretch">
              <code className="flex-1 border-2 border-black bg-canvas px-3 py-2 text-xs font-mono break-all">
                {reveal.full_key}
              </code>
              <button
                onClick={() => onCopy(reveal.full_key, "key")}
                className="px-3 py-2 border-2 border-black bg-white hover:bg-lf-yellow font-bold text-xs uppercase flex items-center gap-1"
              >
                {copiedSlot === "key" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedSlot === "key" ? "Copié" : "Copier"}
              </button>
            </div>
          </div>

          <div className="border-3 border-black bg-canvas p-4">
            <p className="text-xs font-black uppercase tracking-wider mb-2">
              Template Make.com — Meta Lead Ads → LeadFactory
            </p>
            <p className="text-xs text-lf-gray mb-3 leading-relaxed">
              Téléchargez le JSON, puis dans Make.com : <strong>Create a new scenario</strong>{" "}
              → menu <strong>···</strong> → <strong>Import Blueprint</strong> → sélectionnez ce
              fichier. Connectez ensuite le compte Facebook du client, choisissez la Page et le
              formulaire, puis activez. L&apos;URL webhook est déjà pré-remplie.
            </p>
            <button
              onClick={onDownload}
              className="inline-flex items-center gap-2 px-3 py-2 border-3 border-black bg-lf-blue text-white hover:shadow-[3px_3px_0_#000] font-black text-xs uppercase tracking-wider transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Télécharger le blueprint
            </button>
          </div>

          <div className="text-xs text-lf-gray space-y-1">
            <p className="font-bold">Aussi utilisable avec :</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>n8n — node HTTP Request en POST avec body JSON</li>
              <li>Zapier — Webhooks by Zapier · POST</li>
              <li>Pipedream — http.request POST</li>
              <li>Toute intégration capable d&apos;envoyer un POST JSON</li>
            </ul>
          </div>
        </div>

        <footer className="border-t-3 border-black p-4 flex gap-2 bg-canvas">
          <a
            href="https://www.make.com/en/scenarios/create"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border-3 border-black bg-white hover:bg-lf-yellow font-bold uppercase text-xs"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Ouvrir Make.com
          </a>
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 border-3 border-black bg-lf-black text-white hover:bg-lf-blue font-black uppercase text-xs tracking-wider"
          >
            J&apos;ai sauvegardé
          </button>
        </footer>
      </div>
    </div>
  );
}
