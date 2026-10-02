"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Check, Loader2, Lock, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";

interface Profile {
  full_name: string;
  company?: string;
  phone?: string;
  role: string;
}

interface Props {
  profile: Profile | null;
  email: string;
}

export function ClientSettingsForm({ profile, email }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [company, setCompany] = useState(profile?.company ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Password change
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/update-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, company, phone }),
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
    if (!currentPwd) {
      setPwdMsg({ type: "error", text: "Veuillez saisir votre mot de passe actuel." });
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdMsg({ type: "error", text: "Les mots de passe ne correspondent pas." });
      return;
    }
    if (newPwd.length < 8) {
      setPwdMsg({ type: "error", text: "Le mot de passe doit faire au moins 8 caractères." });
      return;
    }
    setPwdLoading(true);
    setPwdMsg(null);
    try {
      const supabase = createClient();
      // Re-authenticate with the current password before updating
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user?.email;
      if (!email) throw new Error("Session expirée. Veuillez vous reconnecter.");
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPwd });
      if (signInError) throw new Error("Mot de passe actuel incorrect.");
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) throw error;
      setPwdMsg({ type: "success", text: "Mot de passe mis à jour avec succès." });
      setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
    } catch (e: unknown) {
      setPwdMsg({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Profil */}
      <div className="card-brutal overflow-hidden">
        <div className="px-5 py-4 bg-lf-black text-white">
          <p className="font-black uppercase text-sm tracking-wider">Informations du compte</p>
        </div>
        <form onSubmit={handleSaveProfile} className="p-6 flex flex-col gap-4">
          <div>
            <label className="label-brutal">Email</label>
            <input
              type="email"
              value={email}
              disabled
              className="input-brutal bg-gray-100 text-lf-gray cursor-not-allowed"
            />
            <p className="hint-brutal">L'email ne peut pas être modifié. Contactez Lead Factory si nécessaire.</p>
          </div>
          <div>
            <label className="label-brutal">Nom complet</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Prénom Nom"
              className="input-brutal"
            />
          </div>
          <div>
            <label className="label-brutal">Entreprise</label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Nom de votre entreprise"
              className="input-brutal"
            />
          </div>
          <div>
            <label className="label-brutal">Téléphone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+33 6 00 00 00 00"
              className="input-brutal"
            />
          </div>

          {error && (
            <p className="text-red-600 font-bold text-sm border-3 border-red-400 bg-red-50 px-4 py-3">{error}</p>
          )}

          <button type="submit" disabled={saving} className={`flex items-center gap-2 text-sm ${saving ? "btn-disabled" : "btn-primary"}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? "Sauvegardé !" : "Enregistrer les modifications"}
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
            <label className="label-brutal">Mot de passe actuel</label>
            <input
              type="password"
              value={currentPwd}
              onChange={(e) => setCurrentPwd(e.target.value)}
              placeholder="Votre mot de passe actuel"
              required
              className="input-brutal"
            />
          </div>
          <div>
            <label className="label-brutal">Nouveau mot de passe</label>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="Minimum 8 caractères"
              required
              className="input-brutal"
            />
          </div>
          <div>
            <label className="label-brutal">Confirmer le mot de passe</label>
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="Répétez le nouveau mot de passe"
              required
              className="input-brutal"
            />
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

      {/* Logout */}
      <div className="border-3 border-black bg-white p-6 shadow-brutal">
        <h2 className="text-lg font-black uppercase tracking-tight mb-2">Session</h2>
        <p className="text-sm text-lf-gray font-medium mb-4">
          Te déconnecter de ton espace LeadFactory. Tu pourras te reconnecter à tout moment avec ton email + mot de passe.
        </p>
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2.5 font-bold text-sm uppercase tracking-wide text-lf-gray hover:text-red-500 border-3 border-lf-gray hover:border-red-500 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Déconnexion
        </button>
      </div>
    </div>
  );
}
