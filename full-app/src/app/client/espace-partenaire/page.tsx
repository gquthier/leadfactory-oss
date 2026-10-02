"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { ReferralOfferCard } from "@/components/client/ReferralOfferCard";

type PartnerLink = { title: string; url: string };
const STORAGE_KEY = "leadfactory-starter-partner-links-v1";
function safeLink(value: unknown): value is PartnerLink {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PartnerLink>;
  if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 100 || typeof item.url !== "string" || item.url.length > 2000) return false;
  try {
    const url = new URL(item.url);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

export default function ClientPartnerSpace() {
  const [links, setLinks] = useState<PartnerLink[]>([]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(stored)) setLinks(stored.filter(safeLink).slice(0, 20));
    } catch { /* Une préférence absente ou invalide conserve la liste vide. */ }
  }, []);
  function save(next: PartnerLink[]) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setLinks(next); setError(""); }
    catch { setError("Le navigateur n’a pas pu enregistrer ces liens."); }
  }
  return (
    <div className="p-6 lg:p-10 max-w-5xl">
      <div className="sticker -rotate-1 inline-block mb-3">ESPACE PARTENAIRE</div>
      <h1 className="text-4xl font-black uppercase tracking-tight mb-3">Vos liens et vos recommandations</h1>
      <p className="text-lf-gray font-medium text-lg mb-8">Ajoutez les outils et ressources que vous avez choisis. Aucun partenaire ni offre commerciale n’est sélectionné à votre place.</p>
      <ReferralOfferCard />
      <section className="card-brutal p-6">
        <h2 className="text-2xl font-black uppercase mb-3">Configurer mes liens</h2>
        <p className="text-sm text-lf-gray mb-5">Ces liens restent dans ce navigateur, pour cette installation. Ils ne sont pas synchronisés avec les autres clients. N’y mettez aucun token, lien d’accès privé ou secret.</p>
        <form className="flex flex-col gap-3 mb-6" onSubmit={(event) => {
          event.preventDefault();
          const item = { title: title.trim(), url: url.trim() };
          if (!safeLink(item)) { setError("Indiquez un titre et une URL HTTPS sans identifiants."); return; }
          if (links.length >= 20) { setError("La liste est limitée à 20 liens."); return; }
          save([...links, item]); setTitle(""); setUrl("");
        }}>
          <label className="font-bold text-sm">Nom de la ressource<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} required className="block w-full border-3 border-black px-3 py-2 mt-1" /></label>
          <label className="font-bold text-sm">Adresse HTTPS<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} maxLength={2000} required className="block w-full border-3 border-black px-3 py-2 mt-1" /></label>
          {error && <p role="alert" className="font-bold text-red-700">{error}</p>}
          <button type="submit" className="self-start inline-flex items-center gap-2 border-3 border-black bg-lf-yellow px-4 py-2 font-black"><Plus className="w-4 h-4" />Ajouter le lien</button>
        </form>
        {links.length === 0 && <p className="border-3 border-dashed border-black/20 p-6 text-lf-gray">Aucun lien configuré.</p>}
        <div className="flex flex-col gap-3">{links.map((item, index) => (
          <div key={`${item.url}-${index}`} className="border-3 border-black p-4 flex items-center gap-4">
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex gap-2 items-center font-black">{item.title}<ExternalLink className="w-4 h-4" /></a>
            <button type="button" onClick={() => save(links.filter((_, i) => i !== index))} aria-label={`Retirer ${item.title}`} className="p-2 border-2 border-black"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}</div>
      </section>
    </div>
  );
}
