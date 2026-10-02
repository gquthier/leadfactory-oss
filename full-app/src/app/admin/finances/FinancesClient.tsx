"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CalendarClock,
  CircleDollarSign,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  TrendingUp,
  Trash2,
  Wallet,
} from "lucide-react";
import type {
  ClientFinanceProfile,
  FinanceDashboardRow,
  FinanceDashboardSummary,
  FinanceEntry,
  FinanceEntryType,
  FinancePhase,
} from "@/types/index";

const CATEGORY_SUGGESTIONS = [
  "trial",
  "mrr",
  "upsell",
  "one_shot",
  "meta_ads",
  "google_workspace",
  "ghl",
  "salary",
  "contractor",
  "software",
  "other",
];

type ProfileFormState = {
  client_id: string;
  phase: FinancePhase;
  trial_amount: string;
  trial_start_date: string;
  trial_end_date: string;
  mrr_amount: string;
  next_payment_date: string;
  last_payment_date: string;
  notes: string;
};

type EntryFormState = {
  client_id: string;
  entry_type: FinanceEntryType;
  category: string;
  label: string;
  amount: string;
  entry_date: string;
  received_by: string;
  notes: string;
};

function formatCurrency(value: number) {
  return value.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatMultiplier(value: number | null) {
  if (value == null) return "—";
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}x`;
}

function formatPercent(value: number | null) {
  if (value == null) return "—";
  return `${(value * 100).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toInputValue(value: number | null) {
  return value == null ? "" : String(value);
}

function buildProfileForm(profile: ClientFinanceProfile): ProfileFormState {
  return {
    client_id: profile.client_id,
    phase: profile.phase,
    trial_amount: toInputValue(profile.trial_amount),
    trial_start_date: profile.trial_start_date ?? "",
    trial_end_date: profile.trial_end_date ?? "",
    mrr_amount: toInputValue(profile.mrr_amount),
    next_payment_date: profile.next_payment_date ?? "",
    last_payment_date: profile.last_payment_date ?? "",
    notes: profile.notes ?? "",
  };
}

function buildEntryForm(month: string, clientId = ""): EntryFormState {
  return {
    client_id: clientId,
    entry_type: "revenue",
    category: "trial",
    label: "",
    amount: "",
    entry_date: `${month}-01`,
    received_by: "",
    notes: "",
  };
}

function PaymentBadge({ row }: { row: FinanceDashboardRow }) {
  if (!row.next_payment_date) {
    return (
      <span className="inline-flex items-center gap-1 border-2 border-black bg-white px-2 py-1 text-xs font-black uppercase tracking-wider">
        À renseigner
      </span>
    );
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const paymentDate = new Date(`${row.next_payment_date}T00:00:00`);
  const isLate = paymentDate < now && row.manual_revenue < row.expected_revenue;

  return (
    <span
      className={`inline-flex items-center gap-1 border-2 px-2 py-1 text-xs font-black uppercase tracking-wider ${
        isLate
          ? "border-red-600 bg-red-100 text-red-700"
          : "border-black bg-lf-yellow text-black"
      }`}
    >
      <CalendarClock className="h-3 w-3" />
      {formatDate(row.next_payment_date)}
    </span>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ElementType;
  className?: string;
}) {
  return (
    <div className={`card-brutal-sm p-5 ${className ?? "bg-white"}`}>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wider opacity-70">{label}</p>
          <p className="mt-2 text-3xl font-black leading-none">{value}</p>
        </div>
        <Icon className="h-7 w-7 opacity-30" />
      </div>
      {hint && <p className="text-xs font-bold uppercase tracking-wide opacity-70">{hint}</p>}
    </div>
  );
}

export function FinancesClient({
  month,
  monthLabel,
  rows,
  entries,
  summary,
  metaConnected,
}: {
  month: string;
  monthLabel: string;
  rows: FinanceDashboardRow[];
  entries: FinanceEntry[];
  summary: FinanceDashboardSummary;
  metaConnected: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [selectedClientId, setSelectedClientId] = useState(rows[0]?.client_id ?? "");
  const [profileForm, setProfileForm] = useState<ProfileFormState | null>(
    rows[0] ? buildProfileForm(rows[0].finance_profile) : null
  );
  const [entryForm, setEntryForm] = useState<EntryFormState>(buildEntryForm(month, rows[0]?.client_id ?? ""));
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  const selectedRow = rows.find((row) => row.client_id === selectedClientId) ?? rows[0];

  useEffect(() => {
    setSelectedMonth(month);
    if (!editingEntryId) {
      setEntryForm(buildEntryForm(month, selectedRow?.client_id ?? ""));
    }
  }, [month, editingEntryId, selectedRow]);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedClientId("");
      return;
    }

    const stillExists = rows.some((row) => row.client_id === selectedClientId);
    if (!stillExists) {
      setSelectedClientId(rows[0].client_id);
    }
  }, [rows, selectedClientId]);

  useEffect(() => {
    if (!selectedRow) {
      setProfileForm(null);
      return;
    }
    setProfileForm(buildProfileForm(selectedRow.finance_profile));
    if (!editingEntryId) {
      setEntryForm((current) => ({
        ...current,
        client_id: selectedRow.client_id,
      }));
    }
  }, [selectedRow, editingEntryId]);

  const handleMonthChange = (value: string) => {
    setSelectedMonth(value);
    startTransition(() => {
      router.push(`/admin/finances?month=${value}`);
    });
  };

  const refresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const handleSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profileForm) return;

    setSavingProfile(true);
    try {
      const response = await fetch("/api/admin/finances/client-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: profileForm.client_id,
          phase: profileForm.phase,
          trial_amount: profileForm.trial_amount ? Number(profileForm.trial_amount) : null,
          trial_start_date: profileForm.trial_start_date || null,
          trial_end_date: profileForm.trial_end_date || null,
          mrr_amount: profileForm.mrr_amount ? Number(profileForm.mrr_amount) : null,
          next_payment_date: profileForm.next_payment_date || null,
          last_payment_date: profileForm.last_payment_date || null,
          notes: profileForm.notes || null,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Impossible de sauvegarder la configuration client.");
      }

      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setSavingProfile(false);
    }
  };

  const resetEntryForm = () => {
    setEditingEntryId(null);
    setEntryForm(buildEntryForm(month, selectedRow?.client_id ?? ""));
  };

  const handleSaveEntry = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingEntry(true);

    try {
      const payload = {
        client_id: entryForm.client_id || null,
        entry_type: entryForm.entry_type,
        category: entryForm.category || "other",
        label: entryForm.label,
        amount: Number(entryForm.amount),
        entry_date: entryForm.entry_date,
        received_by: entryForm.received_by || null,
        notes: entryForm.notes || null,
      };

      const endpoint = editingEntryId
        ? `/api/admin/finances/entries/${editingEntryId}`
        : "/api/admin/finances/entries";
      const method = editingEntryId ? "PATCH" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Impossible de sauvegarder l'écriture.");
      }

      resetEntryForm();
      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setSavingEntry(false);
    }
  };

  const handleEditEntry = (entry: FinanceEntry) => {
    setEditingEntryId(entry.id);
    setEntryForm({
      client_id: entry.client_id ?? "",
      entry_type: entry.entry_type,
      category: entry.category,
      label: entry.label,
      amount: String(entry.amount),
      entry_date: entry.entry_date,
      received_by: entry.received_by ?? "",
      notes: entry.notes ?? "",
    });
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!window.confirm("Supprimer cette écriture financière ?")) return;

    setDeletingEntryId(entryId);
    try {
      const response = await fetch(`/api/admin/finances/entries/${entryId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Impossible de supprimer l'écriture.");
      }

      if (editingEntryId === entryId) {
        resetEntryForm();
      }
      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setDeletingEntryId(null);
    }
  };

  return (
    <div className="max-w-[1680px] p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="sticker-yellow -rotate-1 inline-block">FINANCE</div>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-tight">Pilotage financier</h1>
          <p className="mt-1 text-sm font-medium text-lf-gray">
            Vue super-admin dédiée aux revenus attendus, encaissements, dépenses et ROI publicitaire.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex flex-col gap-1 text-xs font-black uppercase tracking-wider text-lf-gray">
            Mois
            <input
              type="month"
              value={selectedMonth}
              onChange={(event) => handleMonthChange(event.target.value)}
              className="input-brutal min-w-44 bg-white text-sm"
            />
          </label>
          <button
            type="button"
            onClick={refresh}
            className="btn-secondary flex items-center justify-center gap-2 text-sm"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Recharger
          </button>
        </div>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="CA attendu"
          value={formatCurrency(summary.expected_revenue)}
          hint={monthLabel}
          icon={CircleDollarSign}
          className="bg-white"
        />
        <StatCard
          label="Encaissements"
          value={formatCurrency(summary.manual_revenue)}
          hint="Écritures revenue du mois"
          icon={Wallet}
          className="bg-lf-green text-white"
        />
        <StatCard
          label="Dépenses"
          value={formatCurrency(summary.total_expenses)}
          hint={`Ads ${formatCurrency(summary.ad_spend)} · charges ${formatCurrency(summary.manual_expenses)}`}
          icon={Landmark}
          className="bg-lf-yellow"
        />
        <StatCard
          label="Recurring"
          value={formatCurrency(summary.recurring_revenue)}
          hint="MRR actif"
          icon={TrendingUp}
          className="bg-lf-blue text-white"
        />
        <StatCard
          label="Marge"
          value={formatCurrency(summary.margin)}
          hint="CA attendu - dépenses"
          icon={TrendingUp}
          className="bg-white"
        />
        <StatCard
          label="Profit net"
          value={formatCurrency(summary.net_profit)}
          hint="Encaissements - dépenses"
          icon={Wallet}
          className="bg-white"
        />
        <StatCard
          label="ROAS pub"
          value={formatMultiplier(summary.roas)}
          hint="CRM CA / spend Meta"
          icon={TrendingUp}
          className="bg-white"
        />
        <StatCard
          label="ROI pub"
          value={formatPercent(summary.roi)}
          hint="(CRM CA - spend) / spend"
          icon={TrendingUp}
          className="bg-white"
        />
      </div>

      {!metaConnected && (
        <div className="card-brutal-sm mb-8 flex items-start gap-3 bg-lf-yellow p-5">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-black uppercase tracking-wide">Spend Meta indisponible</p>
            <p className="mt-1 text-sm font-medium">
              Le module finance fonctionne sans token Meta, mais les colonnes `Ads`, `ROAS` et `ROI`
              restent à zéro tant qu&apos;aucun compte publicitaire connecté n&apos;est exploitable.
            </p>
          </div>
        </div>
      )}

      <div className="card-brutal mb-8 overflow-hidden">
        <div className="flex items-center justify-between border-b-3 border-black bg-lf-black px-5 py-4 text-white">
          <div>
            <p className="text-sm font-black uppercase tracking-wider">Table finances</p>
            <p className="text-xs font-medium text-white/70">
              Inspiré du template P&amp;L client et enrichi avec le recurring, le cash et le spend Meta.
            </p>
          </div>
          <span className="text-xs font-black uppercase tracking-wider text-lf-yellow">
            {rows.length} client{rows.length > 1 ? "s" : ""}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1450px] w-full">
            <thead className="border-b-3 border-black bg-gray-50">
              <tr className="text-left text-xs font-black uppercase tracking-wider text-lf-gray">
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Phase</th>
                <th className="px-4 py-3">Paiement</th>
                <th className="px-4 py-3">Attendu</th>
                <th className="px-4 py-3">Encaissements</th>
                <th className="px-4 py-3">CRM CA</th>
                <th className="px-4 py-3">CRM Cash</th>
                <th className="px-4 py-3">Ads</th>
                <th className="px-4 py-3">Charges</th>
                <th className="px-4 py-3">Marge</th>
                <th className="px-4 py-3">Profit net</th>
                <th className="px-4 py-3">Recurring</th>
                <th className="px-4 py-3">ROI Ads</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected = row.client_id === selectedClientId;

                return (
                  <tr
                    key={row.client_id}
                    className={`border-b-3 border-black align-top text-sm ${
                      isSelected ? "bg-lf-yellow/15" : "bg-white"
                    }`}
                  >
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => setSelectedClientId(row.client_id)}
                        className="text-left"
                      >
                        <p className="font-black uppercase">{row.client_name}</p>
                        <p className="text-xs font-medium text-lf-gray">{row.contact_name}</p>
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex border-2 px-2 py-1 text-xs font-black uppercase tracking-wider ${
                          row.finance_profile.phase === "mrr"
                            ? "border-lf-blue bg-lf-blue text-white"
                            : "border-black bg-white"
                        }`}
                      >
                        {row.finance_profile.phase === "mrr" ? "MRR" : "TRIAL"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <PaymentBadge row={row} />
                    </td>
                    <td className="px-4 py-4 font-black">{formatCurrency(row.expected_revenue)}</td>
                    <td className="px-4 py-4 font-black text-lf-green">{formatCurrency(row.manual_revenue)}</td>
                    <td className="px-4 py-4 font-black">{formatCurrency(row.crm_revenue)}</td>
                    <td className="px-4 py-4 font-black">{formatCurrency(row.crm_cash)}</td>
                    <td className="px-4 py-4 font-black">{formatCurrency(row.ad_spend)}</td>
                    <td className="px-4 py-4 font-black">{formatCurrency(row.manual_expenses)}</td>
                    <td className="px-4 py-4 font-black">{formatCurrency(row.margin)}</td>
                    <td className="px-4 py-4 font-black">{formatCurrency(row.net_profit)}</td>
                    <td className="px-4 py-4 font-black">{formatCurrency(row.recurring_revenue)}</td>
                    <td className="px-4 py-4">
                      <p className="font-black">{formatPercent(row.roi)}</p>
                      <p className="text-xs font-medium text-lf-gray">{formatMultiplier(row.roas)}</p>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => setSelectedClientId(row.client_id)}
                        className="btn-secondary text-xs"
                      >
                        Configurer
                      </button>
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-10 text-center text-sm font-medium text-lf-gray">
                    Aucun client disponible.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <div className="card-brutal overflow-hidden">
            <div className="border-b-3 border-black bg-lf-black px-5 py-4 text-white">
              <p className="text-sm font-black uppercase tracking-wider">Configuration client</p>
              <p className="text-xs font-medium text-white/70">
                Trial vs MRR, montant, date de paiement et notes de suivi.
              </p>
            </div>

            {selectedRow && profileForm ? (
              <form onSubmit={handleSaveProfile} className="grid gap-4 p-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <p className="text-lg font-black uppercase">{selectedRow.client_name}</p>
                  <p className="text-xs font-medium text-lf-gray">
                    {selectedRow.email} · {selectedRow.campaigns.length} campagne{selectedRow.campaigns.length > 1 ? "s" : ""}
                  </p>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Phase</span>
                  <select
                    value={profileForm.phase}
                    onChange={(event) =>
                      setProfileForm((current) => current ? { ...current, phase: event.target.value as FinancePhase } : current)
                    }
                    className="input-brutal bg-white"
                  >
                    <option value="trial">Trial</option>
                    <option value="mrr">MRR</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Date paiement</span>
                  <input
                    type="date"
                    value={profileForm.next_payment_date}
                    onChange={(event) =>
                      setProfileForm((current) => current ? { ...current, next_payment_date: event.target.value } : current)
                    }
                    className="input-brutal bg-white"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Montant trial</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={profileForm.trial_amount}
                    onChange={(event) =>
                      setProfileForm((current) => current ? { ...current, trial_amount: event.target.value } : current)
                    }
                    className="input-brutal bg-white"
                    placeholder="0"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Montant MRR</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={profileForm.mrr_amount}
                    onChange={(event) =>
                      setProfileForm((current) => current ? { ...current, mrr_amount: event.target.value } : current)
                    }
                    className="input-brutal bg-white"
                    placeholder="0"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Début trial</span>
                  <input
                    type="date"
                    value={profileForm.trial_start_date}
                    onChange={(event) =>
                      setProfileForm((current) => current ? { ...current, trial_start_date: event.target.value } : current)
                    }
                    className="input-brutal bg-white"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Fin trial</span>
                  <input
                    type="date"
                    value={profileForm.trial_end_date}
                    onChange={(event) =>
                      setProfileForm((current) => current ? { ...current, trial_end_date: event.target.value } : current)
                    }
                    className="input-brutal bg-white"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Dernier paiement</span>
                  <input
                    type="date"
                    value={profileForm.last_payment_date}
                    onChange={(event) =>
                      setProfileForm((current) => current ? { ...current, last_payment_date: event.target.value } : current)
                    }
                    className="input-brutal bg-white"
                  />
                </label>

                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Notes</span>
                  <textarea
                    value={profileForm.notes}
                    onChange={(event) =>
                      setProfileForm((current) => current ? { ...current, notes: event.target.value } : current)
                    }
                    rows={4}
                    className="input-brutal bg-white"
                    placeholder="Ex: client en mois test, bascule en MRR après validation."
                  />
                </label>

                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
                  >
                    {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Sauvegarder la configuration
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-5 text-sm font-medium text-lf-gray">Sélectionne un client pour le configurer.</div>
            )}
          </div>

          <div className="card-brutal overflow-hidden">
            <div className="border-b-3 border-black bg-lf-black px-5 py-4 text-white">
              <p className="text-sm font-black uppercase tracking-wider">Écritures du mois</p>
              <p className="text-xs font-medium text-white/70">
                Revenus et dépenses saisis manuellement, affectés ou non à un client.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[940px] w-full">
                <thead className="border-b-3 border-black bg-gray-50 text-left text-xs font-black uppercase tracking-wider text-lf-gray">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Catégorie</th>
                    <th className="px-4 py-3">Libellé</th>
                    <th className="px-4 py-3">Montant</th>
                    <th className="px-4 py-3">Réception</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b-3 border-black bg-white text-sm">
                      <td className="px-4 py-3 font-bold">{formatDate(entry.entry_date)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex border-2 px-2 py-1 text-xs font-black uppercase tracking-wider ${
                            entry.entry_type === "revenue"
                              ? "border-lf-green bg-lf-green text-white"
                              : "border-black bg-white"
                          }`}
                        >
                          {entry.entry_type === "revenue" ? "Revenue" : "Expense"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold">
                        {entry.profiles?.company ?? entry.profiles?.full_name ?? "Non affecté"}
                      </td>
                      <td className="px-4 py-3 font-bold uppercase">{entry.category}</td>
                      <td className="px-4 py-3">
                        <p className="font-black">{entry.label}</p>
                        {entry.notes && <p className="text-xs font-medium text-lf-gray">{entry.notes}</p>}
                      </td>
                      <td className="px-4 py-3 font-black">{formatCurrency(entry.amount)}</td>
                      <td className="px-4 py-3 font-bold">{entry.received_by ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditEntry(entry)}
                            className="btn-secondary px-3 py-2 text-xs"
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteEntry(entry.id)}
                            disabled={deletingEntryId === entry.id}
                            className="inline-flex items-center gap-1 border-2 border-red-500 px-3 py-2 text-xs font-black uppercase tracking-wider text-red-600 disabled:opacity-50"
                          >
                            {deletingEntryId === entry.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                            Suppr.
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm font-medium text-lf-gray">
                        Aucune écriture sur ce mois.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card-brutal h-fit overflow-hidden">
          <div className="border-b-3 border-black bg-lf-black px-5 py-4 text-white">
            <p className="text-sm font-black uppercase tracking-wider">
              {editingEntryId ? "Modifier l'écriture" : "Nouvelle écriture"}
            </p>
            <p className="text-xs font-medium text-white/70">
              Utilise ce formulaire pour saisir les revenus encaissés et les charges du mois.
            </p>
          </div>

          <form onSubmit={handleSaveEntry} className="space-y-4 p-5">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Client</span>
              <select
                value={entryForm.client_id}
                onChange={(event) => setEntryForm((current) => ({ ...current, client_id: event.target.value }))}
                className="input-brutal bg-white"
              >
                <option value="">Non affecté</option>
                {rows.map((row) => (
                  <option key={row.client_id} value={row.client_id}>
                    {row.client_name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Type</span>
                <select
                  value={entryForm.entry_type}
                  onChange={(event) =>
                    setEntryForm((current) => ({
                      ...current,
                      entry_type: event.target.value as FinanceEntryType,
                      category: event.target.value === "revenue" ? "trial" : "meta_ads",
                    }))
                  }
                  className="input-brutal bg-white"
                >
                  <option value="revenue">Revenue</option>
                  <option value="expense">Expense</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Catégorie</span>
                <input
                  list="finance-categories"
                  value={entryForm.category}
                  onChange={(event) => setEntryForm((current) => ({ ...current, category: event.target.value }))}
                  className="input-brutal bg-white"
                />
                <datalist id="finance-categories">
                  {CATEGORY_SUGGESTIONS.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Libellé</span>
              <input
                type="text"
                value={entryForm.label}
                onChange={(event) => setEntryForm((current) => ({ ...current, label: event.target.value }))}
                className="input-brutal bg-white"
                placeholder="Ex: Paiement avril / Google Workspace / Meta Ads"
                required
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Montant</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={entryForm.amount}
                  onChange={(event) => setEntryForm((current) => ({ ...current, amount: event.target.value }))}
                  className="input-brutal bg-white"
                  placeholder="0"
                  required
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Date</span>
                <input
                  type="date"
                  value={entryForm.entry_date}
                  onChange={(event) => setEntryForm((current) => ({ ...current, entry_date: event.target.value }))}
                  className="input-brutal bg-white"
                  required
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Réception des fonds / responsable</span>
              <input
                type="text"
                value={entryForm.received_by}
                onChange={(event) => setEntryForm((current) => ({ ...current, received_by: event.target.value }))}
                className="input-brutal bg-white"
                placeholder="Ex: Thomas, Responsable"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-black uppercase tracking-wider text-lf-gray">Notes</span>
              <textarea
                rows={4}
                value={entryForm.notes}
                onChange={(event) => setEntryForm((current) => ({ ...current, notes: event.target.value }))}
                className="input-brutal bg-white"
                placeholder="Commentaire complémentaire"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={savingEntry}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
              >
                {savingEntry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {editingEntryId ? "Mettre à jour" : "Ajouter l'écriture"}
              </button>

              {editingEntryId && (
                <button type="button" onClick={resetEntryForm} className="btn-secondary text-sm">
                  Annuler la modification
                </button>
              )}
            </div>

            <div className="border-t-3 border-black pt-4 text-xs font-medium text-lf-gray">
              Charges non affectées ce mois : <span className="font-black text-black">{formatCurrency(summary.unassigned_expenses)}</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
