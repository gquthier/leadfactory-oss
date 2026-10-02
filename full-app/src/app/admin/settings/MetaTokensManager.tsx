"use client";

import { useState } from "react";
import { Plus, Trash2, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff, Zap } from "lucide-react";

interface MetaToken {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

interface TestResult {
  ok: boolean;
  user?: { id: string; name: string };
  adAccountsTotal?: number;
  adAccountsActive?: number;
  adAccounts?: { id: string; name: string }[];
  error?: string;
}

interface Props {
  initialTokens: MetaToken[];
}

export function MetaTokensManager({ initialTokens }: Props) {
  const [tokens, setTokens] = useState<MetaToken[]>(initialTokens);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newToken, setNewToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!newName.trim() || !newToken.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/meta-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), token: newToken.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setTokens((prev) => [...prev, data.token]);
        setNewName("");
        setNewToken("");
        setShowAddForm(false);
        setShowToken(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const res = await fetch(`/api/admin/meta-tokens/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [id]: data }));
    } finally {
      setTesting(null);
    }
  };

  const handleToggleActive = async (id: string, current: boolean) => {
    await fetch(`/api/admin/meta-tokens/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !current }),
    });
    setTokens((prev) => prev.map((t) => t.id === id ? { ...t, is_active: !current } : t));
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce token ? Les campagnes liées seront détachées.")) return;
    setDeleting(id);
    try {
      await fetch(`/api/admin/meta-tokens/${id}`, { method: "DELETE" });
      setTokens((prev) => prev.filter((t) => t.id !== id));
      setTestResults((prev) => { const n = { ...prev }; delete n[id]; return n; });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Token list */}
      {tokens.length === 0 && !showAddForm && (
        <div className="border-3 border-dashed border-black/30 p-6 text-center">
          <p className="text-sm font-bold text-gray-500 uppercase">Aucun token Meta configuré</p>
          <p className="text-xs text-gray-400 mt-1">Ajoutez un token pour synchroniser vos leads.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {tokens.map((token) => {
          const result = testResults[token.id];
          return (
            <div
              key={token.id}
              className={`border-3 border-black p-4 ${token.is_active ? "bg-white" : "bg-gray-50"}`}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-none ${token.is_active ? "bg-lf-green" : "bg-gray-300"}`} />
                  <span className="font-black uppercase tracking-wide text-sm">{token.name}</span>
                  <span className="text-xs text-gray-400">
                    — ajouté le {new Date(token.created_at).toLocaleDateString("fr-FR")}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-none">
                  {/* Test */}
                  <button
                    onClick={() => handleTest(token.id)}
                    disabled={testing === token.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase border-2 border-black hover:bg-lf-yellow transition-colors disabled:opacity-50"
                    type="button"
                  >
                    {testing === token.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3" />
                    )}
                    Tester
                  </button>

                  {/* Toggle active */}
                  <button
                    onClick={() => handleToggleActive(token.id, token.is_active)}
                    className={`px-3 py-1.5 text-xs font-black uppercase border-2 border-black transition-colors ${
                      token.is_active ? "bg-lf-green text-white hover:opacity-80" : "bg-white hover:bg-gray-100"
                    }`}
                    type="button"
                  >
                    {token.is_active ? "Actif" : "Inactif"}
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(token.id)}
                    disabled={deleting === token.id}
                    className="p-1.5 border-2 border-transparent hover:border-red-500 hover:text-red-500 transition-colors disabled:opacity-50"
                    type="button"
                    title="Supprimer"
                  >
                    {deleting === token.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Test result */}
              {result && (
                <div className={`mt-3 p-3 border-2 text-xs ${result.ok ? "border-lf-green bg-lf-green/10" : "border-red-400 bg-red-50"}`}>
                  {result.ok ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 font-black text-lf-green">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Token valide — connecté en tant que {result.user?.name}
                      </div>
                      <div className="text-gray-600 pl-5">
                        {result.adAccountsActive}/{result.adAccountsTotal} comptes pub actifs
                        {result.adAccounts && result.adAccounts.length > 0 && (
                          <span className="ml-1">
                            ({result.adAccounts.map(a => a.name).slice(0, 3).join(", ")}
                            {result.adAccounts.length > 3 ? `... +${result.adAccounts.length - 3}` : ""})
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 font-black text-red-600">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {result.error ?? "Token invalide"}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add form */}
      {showAddForm ? (
        <div className="border-3 border-black p-4 bg-white space-y-3">
          <p className="font-black uppercase text-xs tracking-wide">Nouveau token Meta</p>
          <input
            type="text"
            placeholder="Nom (ex: BM Lead Factory, BM Marque Exemple...)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="input-brutal w-full text-sm"
          />
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              placeholder="Token d'accès Meta"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              className="input-brutal w-full text-sm pr-10 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving || !newName.trim() || !newToken.trim()}
              className="btn-primary text-sm flex items-center gap-2"
              type="button"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Ajouter
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewName(""); setNewToken(""); setShowToken(false); }}
              className="btn-secondary text-sm"
              type="button"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 border-3 border-black bg-white hover:bg-lf-yellow transition-colors font-black uppercase text-xs tracking-wide"
          type="button"
        >
          <Plus className="w-4 h-4" />
          Ajouter un token Meta
        </button>
      )}
    </div>
  );
}
