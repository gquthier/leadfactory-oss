"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { Flame, ExternalLink, Check, Pencil, X, Loader2 } from "lucide-react";
import {
  CLIENT_RESULTS_RATINGS,
  CLIENT_RESULTS_RATING_LABELS,
  getClientResultsRatingColor,
  getClientResultsRatingLabel,
  getClientResultsRatingPriority,
  getCampaignStatusColor,
  getCampaignStatusLabel,
  getCanonicalCampaignStatus,
  type ClientResultsRating,
  type CanonicalCampaignStatus,
} from "@/types/index";
import type { ResultsClientRow } from "./page";

interface Props {
  clients: ResultsClientRow[];
}

function getActiveCampaign(campaigns: ResultsClientRow["campaigns"]) {
  const priority: CanonicalCampaignStatus[] = [
    "live_optimizing",
    "meta_account_setup",
    "ad_creative",
    "campaign_proposal",
    "brief_received",
  ];
  for (const status of priority) {
    const found = campaigns.find((c) => getCanonicalCampaignStatus(c) === status);
    if (found) return found;
  }
  return campaigns[0];
}

const NOT_RATED = "__not_rated__";

export function ResultsClient({ clients: initialClients }: Props) {
  const [clients, setClients] = useState<ResultsClientRow[]>(initialClients);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const resort = useCallback((rows: ResultsClientRow[]) => {
    return [...rows].sort((a, b) => {
      const pa = getClientResultsRatingPriority(a.results_rating);
      const pb = getClientResultsRatingPriority(b.results_rating);
      if (pa !== pb) return pa - pb;
      return (a.company ?? a.full_name).localeCompare(b.company ?? b.full_name);
    });
  }, []);

  const counts = useMemo(() => {
    const map: Record<string, number> = { [NOT_RATED]: 0 };
    for (const r of CLIENT_RESULTS_RATINGS) map[r] = 0;
    for (const c of clients) {
      const key = c.results_rating && c.results_rating in map ? c.results_rating : NOT_RATED;
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [clients]);

  async function patchClient(clientId: string, body: Record<string, unknown>) {
    setSavingId(clientId);
    setError(null);
    try {
      const res = await fetch("/api/admin/update-client", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, ...body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Échec de la sauvegarde");
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function handleRatingChange(clientId: string, value: string) {
    const newRating = value === NOT_RATED ? null : (value as ClientResultsRating);
    // Optimistic update + resort
    const prev = clients;
    const updated = resort(
      clients.map((c) =>
        c.id === clientId
          ? { ...c, results_rating: newRating, results_rating_updated_at: new Date().toISOString() }
          : c
      )
    );
    setClients(updated);
    const ok = await patchClient(clientId, { results_rating: newRating ?? "" });
    if (!ok) setClients(prev); // rollback
  }

  function startEditNote(client: ResultsClientRow) {
    setEditingNoteId(client.id);
    setNoteDraft(client.results_rating_note ?? "");
  }

  async function saveNote(clientId: string) {
    const prev = clients;
    const value = noteDraft.trim();
    setClients(clients.map((c) => (c.id === clientId ? { ...c, results_rating_note: value || null } : c)));
    setEditingNoteId(null);
    const ok = await patchClient(clientId, { results_rating_note: value });
    if (!ok) setClients(prev);
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-600 border-2 border-black flex items-center justify-center">
            <Flame className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl lg:text-3xl font-black uppercase tracking-tight">Résultats</h1>
            <p className="text-sm text-gray-600 font-medium">
              Clients triés par niveau de résultats — on traite ceux qui brûlent en premier.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="my-4 bg-red-50 border-2 border-red-600 text-red-800 px-4 py-2 text-sm font-bold flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Compteurs par niveau */}
      <div className="flex flex-wrap gap-2 my-5">
        {CLIENT_RESULTS_RATINGS.map((r) => (
          <div
            key={r}
            className={`px-3 py-1.5 border-2 border-black text-xs font-black uppercase tracking-wide flex items-center gap-2 ${getClientResultsRatingColor(r)}`}
          >
            <span>{CLIENT_RESULTS_RATING_LABELS[r]}</span>
            <span className="bg-black/20 px-1.5 py-0.5">{counts[r] ?? 0}</span>
          </div>
        ))}
        <div className="px-3 py-1.5 border-2 border-black text-xs font-black uppercase tracking-wide flex items-center gap-2 bg-white text-black">
          <span>Non noté</span>
          <span className="bg-black/10 px-1.5 py-0.5">{counts[NOT_RATED] ?? 0}</span>
        </div>
      </div>

      {/* Liste clients */}
      <div className="border-2 border-black bg-white divide-y-2 divide-black">
        {clients.length === 0 && (
          <div className="px-4 py-10 text-center text-gray-500 font-bold uppercase text-sm">
            Aucun client à afficher.
          </div>
        )}
        {clients.map((client) => {
          const active = getActiveCampaign(client.campaigns);
          const isSaving = savingId === client.id;
          const isEditingNote = editingNoteId === client.id;
          return (
            <div
              key={client.id}
              className={`px-4 py-3 flex flex-col gap-2 ${client.is_active ? "" : "opacity-60"}`}
            >
              <div className="flex items-center gap-3 flex-wrap">
                {/* Identité */}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/clients/${client.id}`}
                    className="font-black text-base hover:text-lf-blue inline-flex items-center gap-1.5 group"
                  >
                    <span className="truncate">{client.company || client.full_name}</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 flex-shrink-0" />
                  </Link>
                  {client.company && (
                    <div className="text-xs text-gray-500 font-medium truncate">{client.full_name}</div>
                  )}
                </div>

                {/* Statut campagne active */}
                {active && (
                  <span
                    className={`hidden sm:inline-block text-[10px] font-black px-2 py-1 border-2 border-black uppercase tracking-wide ${getCampaignStatusColor(active)}`}
                  >
                    {getCampaignStatusLabel(active)}
                  </span>
                )}

                {/* Sélecteur de niveau */}
                <div className="flex items-center gap-2">
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                  <div className={`border-2 border-black ${getClientResultsRatingColor(client.results_rating)}`}>
                    <select
                      value={client.results_rating ?? NOT_RATED}
                      onChange={(e) => handleRatingChange(client.id, e.target.value)}
                      disabled={isSaving}
                      aria-label={`Niveau de résultats de ${client.company || client.full_name}`}
                      className={`bg-transparent text-xs font-black uppercase tracking-wide px-2 py-1.5 outline-none cursor-pointer appearance-none ${getClientResultsRatingColor(client.results_rating).includes("text-white") ? "text-white" : "text-black"}`}
                    >
                      <option value={NOT_RATED} className="bg-white text-black">
                        Non noté
                      </option>
                      {CLIENT_RESULTS_RATINGS.map((r) => (
                        <option key={r} value={r} className="bg-white text-black">
                          {CLIENT_RESULTS_RATING_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Note rapide */}
              <div className="flex items-start gap-2 pl-0.5">
                {isEditingNote ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      autoFocus
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveNote(client.id);
                        if (e.key === "Escape") setEditingNoteId(null);
                      }}
                      placeholder="Note delivery (ex: CPL trop haut, relancer créa)…"
                      className="flex-1 border-2 border-black px-2 py-1 text-xs font-medium outline-none focus:bg-lf-yellow/20"
                    />
                    <button
                      onClick={() => saveNote(client.id)}
                      className="bg-lf-green text-white border-2 border-black p-1 hover:opacity-80"
                      aria-label="Enregistrer la note"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingNoteId(null)}
                      className="bg-white text-black border-2 border-black p-1 hover:bg-gray-100"
                      aria-label="Annuler"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEditNote(client)}
                    className="text-xs text-gray-600 hover:text-black font-medium inline-flex items-center gap-1.5 group text-left"
                  >
                    <Pencil className="w-3 h-3 opacity-40 group-hover:opacity-100 flex-shrink-0" />
                    {client.results_rating_note ? (
                      <span className="italic">{client.results_rating_note}</span>
                    ) : (
                      <span className="text-gray-400">Ajouter une note delivery…</span>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-gray-400 font-medium">
        Le niveau est défini manuellement. Le calcul automatique par seuils (CPL / coût par RDV) arrivera dans une prochaine version.
      </p>
    </div>
  );
}
