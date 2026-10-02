"use client";

import { useState } from "react";
import { UserPlus, Eye, EyeOff, Check, AlertCircle } from "lucide-react";

export function CreateAdminForm() {
  const [form, setForm] = useState({ email: "", full_name: "", password: "" });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/admin/create-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, msg: data.error ?? "Erreur inconnue" });
      } else {
        setResult({ ok: true, msg: `Compte créé ! Email : ${form.email}` });
        setForm({ email: "", full_name: "", password: "" });
      }
    } catch {
      setResult({ ok: false, msg: "Erreur réseau" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label-brutal mb-1 block">Nom complet</label>
          <input
            type="text"
            required
            placeholder="Responsable Thiry"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            className="input-brutal w-full"
          />
        </div>
        <div>
          <label className="label-brutal mb-1 block">Email</label>
          <input
            type="email"
            required
            placeholder="contact@example.com"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="input-brutal w-full"
          />
        </div>
      </div>

      <div>
        <label className="label-brutal mb-1 block">Mot de passe</label>
        <div className="relative">
          <input
            type={showPwd ? "text" : "password"}
            required
            minLength={8}
            placeholder="Min. 8 caractères"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="input-brutal w-full pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-lf-gray hover:text-black"
          >
            {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {result && (
        <div
          className={`flex items-start gap-2 p-3 border-2 border-black text-sm font-bold ${
            result.ok ? "bg-lf-green text-white" : "bg-red-100 text-red-800"
          }`}
        >
          {result.ok ? <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          {result.msg}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="btn-primary flex items-center gap-2 disabled:opacity-50"
      >
        <UserPlus className="w-4 h-4" />
        {loading ? "Création..." : "Créer le compte admin"}
      </button>
    </form>
  );
}
