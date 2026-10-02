"use client";

import { useState } from "react";
import { Save, Check, Loader2, Lock, Zap, CheckCircle, XCircle, Eye, EyeOff, Key, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";

interface Profile {
  full_name: string;
  company?: string;
  phone?: string;
}

interface Props {
  profile: Profile | null;
  email: string;
  hasGeminiKey: boolean;
  hasCustomGeminiKey: boolean;
  hasMetaToken: boolean;
  hasCustomMetaToken: boolean;
}

export function AdminSettingsForm({ profile, email, hasGeminiKey, hasCustomGeminiKey, hasMetaToken, hasCustomMetaToken }: Props) {
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Password change
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Meta token
  const [metaToken, setMetaToken] = useState("");
  const [showMetaToken, setShowMetaToken] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaMsg, setMetaMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hasCustomMeta, setHasCustomMeta] = useState(hasCustomMetaToken);

  // Gemini key
  const [geminiKey, setGeminiKey] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [geminiMsg, setGeminiMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hasCustomKey, setHasCustomKey] = useState(hasCustomGeminiKey);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/update-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, phone }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd !== confirmPwd) {
      setPwdMsg({ type: "error", text: "Les mots de passe ne correspondent pas." });
      return;
    }
    if (newPwd.length < 8) {
      setPwdMsg({ type: "error", text: "Minimum 8 caractères requis." });
      return;
    }
    setPwdLoading(true);
    setPwdMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) throw error;
      setPwdMsg({ type: "success", text: "Mot de passe mis à jour." });
      setNewPwd(""); setConfirmPwd("");
    } catch (e: unknown) {
      setPwdMsg({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setPwdLoading(false);
    }
  };

  const handleSaveMetaToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setMetaSaving(true);
    setMetaMsg(null);
    try {
      const res = await fetch("/api/admin/save-meta-token", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta_access_token: metaToken || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setMetaMsg({ type: "success", text: metaToken ? "Token sauvegardé ! Il sera utilisé immédiatement." : "Token supprimé." });
      setHasCustomMeta(!!metaToken);
      setMetaToken("");
    } catch (e: unknown) {
      setMetaMsg({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setMetaSaving(false);
    }
  };

  const handleSaveGeminiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeminiSaving(true);
    setGeminiMsg(null);
    try {
      const res = await fetch("/api/admin/save-gemini-key", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_api_key: geminiKey || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setGeminiMsg({ type: "success", text: geminiKey ? "Clé sauvegardée avec succès !" : "Clé supprimée." });
      setHasCustomKey(!!geminiKey);
      setGeminiKey("");
    } catch (e: unknown) {
      setGeminiMsg({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setGeminiSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Token Meta ── */}
      <div className="card-brutal overflow-hidden">
        <div className="px-5 py-4 bg-lf-black text-white flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-lf-blue border-2 border-white/40" />
          <p className="font-black uppercase text-sm tracking-wider">Token Meta (Marketing API)</p>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {/* Statut */}
          <div className="flex items-center justify-between p-3 border-3 border-black bg-white">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-lf-blue border-2 border-black" />
              <div>
                <p className="font-black text-sm">Meta Marketing API v21.0</p>
                <p className="text-xs text-lf-gray">
                  {hasCustomMeta
                    ? "Token personnalisé actif (depuis votre profil)"
                    : hasMetaToken
                    ? "Token actif (variable d'environnement)"
                    : "Aucun token configuré"}
                </p>
              </div>
            </div>
            {hasMetaToken || hasCustomMeta ? (
              <div className="flex items-center gap-2 text-lf-green font-black text-xs">
                <CheckCircle className="w-4 h-4" /> Connecté
              </div>
            ) : (
              <div className="flex items-center gap-2 text-red-500 font-black text-xs">
                <XCircle className="w-4 h-4" /> Non configuré
              </div>
            )}
          </div>

          {/* Guide obtenir un token */}
          <div className="p-3 border-3 border-black bg-lf-yellow text-xs font-medium">
            <p className="font-black mb-1 uppercase">Token longue durée (recommandé)</p>
            <p>1. Allez dans Business Manager → Paramètres → Utilisateurs système</p>
            <p>2. Créez un utilisateur système "LeadFactory Bot" (Employé)</p>
            <p>3. Ajoutez vos comptes publicitaires avec accès Analyste</p>
            <p className="mt-1">4. Générez un token avec <code className="bg-white px-1 border border-black">ads_read + ads_management</code></p>
            <a
              href="https://business.facebook.com/settings/system-users"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-black mt-2 underline"
            >
              Ouvrir Business Manager <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Formulaire */}
          <form onSubmit={handleSaveMetaToken} className="flex flex-col gap-3">
            <div>
              <label className="label-brutal">
                {hasCustomMeta ? "Remplacer le token" : "Ajouter votre token Meta"}
              </label>
              <p className="text-xs text-lf-gray font-medium mb-2">
                Le token est sauvegardé en base de données et actif immédiatement — sans redémarrage du serveur.
              </p>
              <div className="relative">
                <input
                  type={showMetaToken ? "text" : "password"}
                  value={metaToken}
                  onChange={(e) => setMetaToken(e.target.value)}
                  placeholder={hasCustomMeta ? "••••••••••••••• (remplacer)" : "EAAW..."}
                  className="input-brutal w-full pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowMetaToken(!showMetaToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-lf-gray hover:text-black transition-colors"
                >
                  {showMetaToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {metaMsg && (
              <p className={`font-bold text-sm border-3 px-4 py-3 ${
                metaMsg.type === "success"
                  ? "border-lf-green bg-lf-green/10 text-lf-green"
                  : "border-red-400 bg-red-50 text-red-600"
              }`}>{metaMsg.text}</p>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={metaSaving || !metaToken}
                className="flex items-center gap-2 text-sm btn-primary disabled:opacity-40"
              >
                {metaSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                {metaToken ? "Sauvegarder le token" : "Entrez un token"}
              </button>
              {hasCustomMeta && (
                <button
                  type="button"
                  disabled={metaSaving}
                  onClick={async () => {
                    setMetaSaving(true);
                    await fetch("/api/admin/save-meta-token", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ meta_access_token: null }),
                    });
                    setHasCustomMeta(false);
                    setMetaToken("");
                    setMetaMsg({ type: "success", text: "Token personnalisé supprimé. La variable d'environnement sera utilisée." });
                    setMetaSaving(false);
                  }}
                  className="flex items-center gap-2 text-sm btn-secondary disabled:opacity-40"
                >
                  <XCircle className="w-4 h-4" /> Supprimer
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* ── Clé Gemini ── */}
      <div className="card-brutal overflow-hidden">
        <div className="px-5 py-4 bg-lf-black text-white flex items-center gap-2">
          <Key className="w-4 h-4 text-lf-yellow" />
          <p className="font-black uppercase text-sm tracking-wider">Clé API Gemini (Ask AI)</p>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {/* Statut actuel */}
          <div className="flex items-center justify-between p-3 border-3 border-black bg-white">
            <div className="flex items-center gap-3">
              <Zap className="w-4 h-4 text-lf-blue" />
              <div>
                <p className="font-black text-sm">Gemini 2.0 Flash</p>
                <p className="text-xs text-lf-gray">
                  {hasCustomKey
                    ? "Clé personnalisée active (depuis votre profil)"
                    : hasGeminiKey
                    ? "Clé active (variable d'environnement)"
                    : "Aucune clé configurée"}
                </p>
              </div>
            </div>
            {hasGeminiKey || hasCustomKey ? (
              <div className="flex items-center gap-2 text-lf-green font-black text-xs">
                <CheckCircle className="w-4 h-4" /> Connecté
              </div>
            ) : (
              <div className="flex items-center gap-2 text-red-500 font-black text-xs">
                <XCircle className="w-4 h-4" /> Non configuré
              </div>
            )}
          </div>

          {/* Formulaire clé */}
          <form onSubmit={handleSaveGeminiKey} className="flex flex-col gap-3">
            <div>
              <label className="label-brutal">
                {hasCustomKey ? "Remplacer la clé" : "Ajouter votre clé Gemini"}
              </label>
              <p className="text-xs text-lf-gray font-medium mb-2">
                Obtenez votre clé sur{" "}
                <span className="font-black underline">aistudio.google.com</span>.
                Elle sera utilisée pour le chat Ask AI et la génération de prompts.
              </p>
              <div className="relative">
                <input
                  type={showGeminiKey ? "text" : "password"}
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder={hasCustomKey ? "••••••••••••••• (remplacer)" : "AIzaSy..."}
                  className="input-brutal w-full pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-lf-gray hover:text-black transition-colors"
                >
                  {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {geminiMsg && (
              <p className={`font-bold text-sm border-3 px-4 py-3 ${
                geminiMsg.type === "success"
                  ? "border-lf-green bg-lf-green/10 text-lf-green"
                  : "border-red-400 bg-red-50 text-red-600"
              }`}>{geminiMsg.text}</p>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={geminiSaving || !geminiKey}
                className="flex items-center gap-2 text-sm btn-primary disabled:opacity-40"
              >
                {geminiSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                {geminiKey ? "Sauvegarder la clé" : "Entrez une clé"}
              </button>
              {hasCustomKey && (
                <button
                  type="button"
                  disabled={geminiSaving}
                  onClick={async () => {
                    setGeminiSaving(true);
                    await fetch("/api/admin/save-gemini-key", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ gemini_api_key: null }),
                    });
                    setHasCustomKey(false);
                    setGeminiKey("");
                    setGeminiMsg({ type: "success", text: "Clé personnalisée supprimée. La clé d'environnement sera utilisée." });
                    setGeminiSaving(false);
                  }}
                  className="flex items-center gap-2 text-sm btn-secondary disabled:opacity-40"
                >
                  <XCircle className="w-4 h-4" /> Supprimer ma clé
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* ── Statut des intégrations ── */}
      <div className="card-brutal-sm overflow-hidden">
        <div className="px-5 py-4 border-b-3 border-black">
          <p className="font-black uppercase text-sm tracking-wider">Statut des intégrations</p>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between p-3 border-3 border-black bg-white">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-lf-green border-2 border-black" />
              <div>
                <p className="font-black text-sm">Supabase</p>
                <p className="text-xs text-lf-gray">Base de données & Auth</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-lf-green font-black text-xs">
              <CheckCircle className="w-4 h-4" /> Connecté
            </div>
          </div>
          <div className="flex items-center justify-between p-3 border-3 border-black bg-white">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-lf-blue border-2 border-black" />
              <div>
                <p className="font-black text-sm">Meta Marketing API</p>
                <p className="text-xs text-lf-gray">Données campagnes & insights</p>
              </div>
            </div>
            {hasMetaToken || hasCustomMeta ? (
              <div className="flex items-center gap-2 text-lf-green font-black text-xs">
                <CheckCircle className="w-4 h-4" /> Connecté
              </div>
            ) : (
              <div className="flex items-center gap-2 text-red-500 font-black text-xs">
                <XCircle className="w-4 h-4" /> Non configuré
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Profil admin */}
      <div className="card-brutal overflow-hidden">
        <div className="px-5 py-4 bg-lf-black text-white">
          <p className="font-black uppercase text-sm tracking-wider">Profil administrateur</p>
        </div>
        <form onSubmit={handleSaveProfile} className="p-6 flex flex-col gap-4">
          <div>
            <label className="label-brutal">Email</label>
            <input type="email" value={email} disabled
              className="input-brutal bg-gray-100 text-lf-gray cursor-not-allowed" />
          </div>
          <div>
            <label className="label-brutal">Nom complet</label>
            <input type="text" value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Prénom Nom"
              className="input-brutal" />
          </div>
          <div>
            <label className="label-brutal">Téléphone</label>
            <input type="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+33 6 00 00 00 00"
              className="input-brutal" />
          </div>

          {error && (
            <p className="text-red-600 font-bold text-sm border-3 border-red-400 bg-red-50 px-4 py-3">{error}</p>
          )}

          <button type="submit" disabled={saving} className={`flex items-center gap-2 text-sm ${saving ? "btn-disabled" : "btn-primary"}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? "Sauvegardé !" : "Enregistrer"}
          </button>
        </form>
      </div>

      {/* Mot de passe */}
      <div className="card-brutal overflow-hidden">
        <div className="px-5 py-4 bg-lf-black text-white flex items-center gap-2">
          <Lock className="w-4 h-4" />
          <p className="font-black uppercase text-sm tracking-wider">Changer le mot de passe</p>
        </div>
        <form onSubmit={handleChangePassword} className="p-6 flex flex-col gap-4">
          <div>
            <label className="label-brutal">Nouveau mot de passe</label>
            <input type="password" value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="Minimum 8 caractères" required
              className="input-brutal" />
          </div>
          <div>
            <label className="label-brutal">Confirmer</label>
            <input type="password" value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="Répétez le mot de passe" required
              className="input-brutal" />
          </div>

          {pwdMsg && (
            <p className={`font-bold text-sm border-3 px-4 py-3 ${
              pwdMsg.type === "success"
                ? "border-lf-green bg-lf-green/10 text-lf-green"
                : "border-red-400 bg-red-50 text-red-600"
            }`}>{pwdMsg.text}</p>
          )}

          <button type="submit" disabled={pwdLoading} className={`flex items-center gap-2 text-sm ${pwdLoading ? "btn-disabled" : "btn-secondary"}`}>
            {pwdLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Changer le mot de passe
          </button>
        </form>
      </div>
    </div>
  );
}
