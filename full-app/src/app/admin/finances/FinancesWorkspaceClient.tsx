"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CalendarDays,
  KanbanSquare,
  Loader2,
  PieChart,
  Plus,
  RefreshCw,
  Save,
  Table,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type {
  FinanceDashboardRow,
  FinanceDashboardSummary,
  FinanceEntry,
  FinancePhase,
  TeamMember,
} from "@/types/index";

type SectionMode = "all" | "profits" | "expenses";
type ExpenseViewMode = "table" | "kanban" | "chart";
type ExpenseCategory = "logiciel" | "equipe" | "publicite" | "autres";

type ClientDraft = {
  client_id: string;
  phase: FinancePhase;
  trial_amount: string;
  mrr_amount: string;
  next_payment_date: string;
  payment_entry_id: string | null;
  payment_amount: string;
  payment_date: string;
};

type ExpenseDraft = {
  client_id: string;
  team_member_id: string;
  category: ExpenseCategory;
  label: string;
  amount: string;
  entry_date: string;
  notes: string;
  received_by: string;
};

type ExpenseCard = {
  id: string;
  label: string;
  amount: number;
  category: ExpenseCategory;
  clientName: string | null;
  teamMemberName: string | null;
  entryDate: string;
  notes: string | null;
  isSynthetic?: boolean;
};

const EXPENSE_CATEGORY_META: Record<
  ExpenseCategory,
  { label: string; chip: string; card: string; color: string }
> = {
  logiciel: {
    label: "Logiciel",
    chip: "bg-lf-blue text-white border-lf-blue",
    card: "bg-blue-50",
    color: "#2563eb",
  },
  equipe: {
    label: "Équipe",
    chip: "bg-lf-yellow text-black border-black",
    card: "bg-yellow-50",
    color: "#facc15",
  },
  publicite: {
    label: "Publicité",
    chip: "bg-lf-green text-white border-lf-green",
    card: "bg-green-50",
    color: "#16a34a",
  },
  autres: {
    label: "Autres",
    chip: "bg-gray-200 text-black border-gray-400",
    card: "bg-gray-50",
    color: "#6b7280",
  },
};

function formatCurrency(value: number) {
  return value.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number | null) {
  if (value == null) return "—";
  return `${(value * 100).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

function formatMultiplier(value: number | null) {
  if (value == null) return "—";
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}x`;
}

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isDateWithinRange(value: string, from: string, to: string) {
  return value >= from && value <= to;
}

function getCurrentMonthBounds() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const toDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  return {
    from: toDate(start),
    to: toDate(end),
  };
}

function getNextMonthStart(referenceDate: string) {
  const current = new Date(`${referenceDate}T00:00:00`);
  const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

function normalizeExpenseCategory(value: string | null | undefined): ExpenseCategory {
  const raw = (value ?? "").trim().toLowerCase();

  if (!raw) return "autres";
  if (["logiciel", "software", "google_workspace", "ghl", "saas", "tool", "outils"].includes(raw)) {
    return "logiciel";
  }
  if (["equipe", "team", "salary", "contractor", "staff", "people", "payroll"].includes(raw)) {
    return "equipe";
  }
  if (["publicite", "publicité", "advertising", "ads", "meta_ads", "meta", "google_ads", "media_buying"].includes(raw)) {
    return "publicite";
  }

  return "autres";
}

function buildClientDraft(row: FinanceDashboardRow): ClientDraft {
  return {
    client_id: row.client_id,
    phase: row.finance_profile.phase,
    trial_amount: row.finance_profile.trial_amount == null ? "" : String(row.finance_profile.trial_amount),
    mrr_amount: row.finance_profile.mrr_amount == null ? "" : String(row.finance_profile.mrr_amount),
    next_payment_date: row.finance_profile.next_payment_date ?? "",
    payment_entry_id: row.payment_entry_id,
    payment_amount: row.payment_amount == null ? "" : String(row.payment_amount),
    payment_date: row.payment_date ?? "",
  };
}

function buildExpenseDraft(entry: FinanceEntry): ExpenseDraft {
  return {
    client_id: entry.client_id ?? "",
    team_member_id: entry.team_member_id ?? "",
    category: normalizeExpenseCategory(entry.category),
    label: entry.label,
    amount: String(entry.amount),
    entry_date: entry.entry_date,
    notes: entry.notes ?? "",
    received_by: entry.received_by ?? entry.team_member?.full_name ?? "",
  };
}

function buildNewExpenseDraft(date: string, teamMembers: TeamMember[]): ExpenseDraft {
  return {
    client_id: "",
    team_member_id: teamMembers[0]?.id ?? "",
    category: "equipe",
    label: "",
    amount: "",
    entry_date: date,
    notes: "",
    received_by: teamMembers[0]?.full_name ?? "",
  };
}

function buildClientDrafts(rows: FinanceDashboardRow[]) {
  return rows.reduce<Record<string, ClientDraft>>((acc, row) => {
    acc[row.client_id] = buildClientDraft(row);
    return acc;
  }, {});
}

function buildExpenseDrafts(entries: FinanceEntry[]) {
  return entries.reduce<Record<string, ExpenseDraft>>((acc, entry) => {
    acc[entry.id] = buildExpenseDraft(entry);
    return acc;
  }, {});
}

function getMemberName(teamMembers: TeamMember[], teamMemberId: string) {
  return teamMembers.find((member) => member.id === teamMemberId)?.full_name ?? "";
}

function SectionButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-2 px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors ${
        active
          ? "border-black bg-lf-yellow text-black"
          : "border-black bg-white text-black hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: string;
}) {
  return (
    <div className={`card-brutal-sm p-5 ${accent ?? "bg-white"}`}>
      <p className="text-xs font-black uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-2 text-3xl font-black leading-none">{value}</p>
      <p className="mt-3 text-xs font-bold uppercase tracking-wide opacity-70">{hint}</p>
    </div>
  );
}

function ExpenseChip({ category }: { category: ExpenseCategory }) {
  const meta = EXPENSE_CATEGORY_META[category];
  return (
    <span className={`inline-flex border-2 px-2 py-1 text-[11px] font-black uppercase tracking-wider ${meta.chip}`}>
      {meta.label}
    </span>
  );
}

function ExpenseDonut({
  totals,
}: {
  totals: Record<ExpenseCategory, number>;
}) {
  const categories = Object.keys(EXPENSE_CATEGORY_META) as ExpenseCategory[];
  const total = categories.reduce((sum, category) => sum + totals[category], 0);

  if (total <= 0) {
    return (
      <div className="card-brutal-sm flex h-72 items-center justify-center bg-white p-6 text-sm font-medium text-lf-gray">
        Aucune dépense sur la période.
      </div>
    );
  }

  let cursor = 0;
  const segments = categories.map((category) => {
    const amount = totals[category];
    const start = cursor;
    const end = cursor + (amount / total) * 100;
    cursor = end;
    return `${EXPENSE_CATEGORY_META[category].color} ${start}% ${end}%`;
  });

  return (
    <div className="card-brutal-sm bg-white p-6">
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:items-center">
        <div className="flex justify-center">
          <div
            className="relative h-64 w-64 rounded-full border-3 border-black"
            style={{ background: `conic-gradient(${segments.join(", ")})` }}
          >
            <div className="absolute inset-12 flex items-center justify-center rounded-full border-3 border-black bg-white text-center">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-lf-gray">Total</p>
                <p className="mt-2 text-2xl font-black">{formatCurrency(total)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          {categories.map((category) => {
            const meta = EXPENSE_CATEGORY_META[category];
            const amount = totals[category];
            const share = total > 0 ? amount / total : 0;

            return (
              <div key={category} className={`card-brutal-sm flex items-center justify-between p-4 ${meta.card}`}>
                <div className="flex items-center gap-3">
                  <span className="h-4 w-4 border-2 border-black" style={{ backgroundColor: meta.color }} />
                  <div>
                    <p className="font-black uppercase">{meta.label}</p>
                    <p className="text-xs font-medium text-lf-gray">
                      {(share * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
                    </p>
                  </div>
                </div>
                <p className="font-black">{formatCurrency(amount)}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExpenseKanban({
  totals,
  cards,
}: {
  totals: Record<ExpenseCategory, number>;
  cards: ExpenseCard[];
}) {
  const categories = Object.keys(EXPENSE_CATEGORY_META) as ExpenseCategory[];

  return (
    <div className="grid gap-4 xl:grid-cols-4">
      {categories.map((category) => {
        const meta = EXPENSE_CATEGORY_META[category];
        const items = cards.filter((card) => card.category === category);

        return (
          <div key={category} className="card-brutal-sm overflow-hidden bg-white">
            <div className={`border-b-3 border-black px-4 py-4 ${meta.card}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-black uppercase">{meta.label}</p>
                <ExpenseChip category={category} />
              </div>
              <p className="mt-2 text-sm font-black">{formatCurrency(totals[category])}</p>
            </div>

            <div className="flex max-h-[520px] flex-col gap-3 overflow-y-auto p-4">
              {items.length === 0 && (
                <div className="border-2 border-dashed border-gray-300 p-4 text-sm font-medium text-lf-gray">
                  Aucune dépense.
                </div>
              )}

              {items.map((card) => (
                <div key={card.id} className="card-brutal-sm bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-black">{card.label}</p>
                    <p className="font-black">{formatCurrency(card.amount)}</p>
                  </div>
                  <div className="mt-3 space-y-1 text-xs font-medium text-lf-gray">
                    <p>{formatDate(card.entryDate)}</p>
                    {card.teamMemberName && <p>Équipe : {card.teamMemberName}</p>}
                    {card.clientName && <p>Client : {card.clientName}</p>}
                    {card.notes && <p>{card.notes}</p>}
                    {card.isSynthetic && <p>Donnée automatique</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FinancesWorkspaceClient({
  from,
  to,
  rangeLabel,
  rows,
  entries,
  summary,
  metaConnected,
  teamMembers,
}: {
  from: string;
  to: string;
  rangeLabel: string;
  rows: FinanceDashboardRow[];
  entries: FinanceEntry[];
  summary: FinanceDashboardSummary;
  metaConnected: boolean;
  teamMembers: TeamMember[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sectionMode, setSectionMode] = useState<SectionMode>("all");
  const [expenseViewMode, setExpenseViewMode] = useState<ExpenseViewMode>("table");
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);
  const [clientDrafts, setClientDrafts] = useState<Record<string, ClientDraft>>(buildClientDrafts(rows));
  const [expenseDrafts, setExpenseDrafts] = useState<Record<string, ExpenseDraft>>(
    buildExpenseDrafts(entries.filter((entry) => entry.entry_type === "expense"))
  );
  const [newExpenseDraft, setNewExpenseDraft] = useState<ExpenseDraft>(buildNewExpenseDraft(to, teamMembers));
  const [savingClientId, setSavingClientId] = useState<string | null>(null);
  const [savingExpenseId, setSavingExpenseId] = useState<string | null>(null);
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);
  const [creatingExpense, setCreatingExpense] = useState(false);

  const expenseEntries = useMemo(
    () => entries.filter((entry) => entry.entry_type === "expense"),
    [entries]
  );

  const expenseCards = useMemo<ExpenseCard[]>(() => {
    const cards: ExpenseCard[] = expenseEntries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      amount: entry.amount,
      category: normalizeExpenseCategory(entry.category),
      clientName: entry.client?.company ?? entry.client?.full_name ?? null,
      teamMemberName: entry.team_member?.full_name ?? null,
      entryDate: entry.entry_date,
      notes: entry.notes,
    }));

    if (summary.ad_spend > 0) {
      cards.unshift({
        id: "meta-spend-auto",
        label: "Spend Meta automatique",
        amount: summary.ad_spend,
        category: "publicite",
        clientName: null,
        teamMemberName: null,
        entryDate: to,
        notes: rangeLabel,
        isSynthetic: true,
      });
    }

    return cards;
  }, [expenseEntries, summary.ad_spend, rangeLabel, to]);

  const expenseTotals = useMemo<Record<ExpenseCategory, number>>(() => {
    const base: Record<ExpenseCategory, number> = {
      logiciel: 0,
      equipe: 0,
      publicite: 0,
      autres: 0,
    };

    for (const entry of expenseEntries) {
      base[normalizeExpenseCategory(entry.category)] += entry.amount;
    }
    base.publicite += summary.ad_spend;

    return base;
  }, [expenseEntries, summary.ad_spend]);

  useEffect(() => {
    setFromDate(from);
    setToDate(to);
  }, [from, to]);

  useEffect(() => {
    setClientDrafts(buildClientDrafts(rows));
  }, [rows]);

  useEffect(() => {
    setExpenseDrafts(buildExpenseDrafts(expenseEntries));
  }, [expenseEntries]);

  useEffect(() => {
    setNewExpenseDraft(buildNewExpenseDraft(to, teamMembers));
  }, [to, teamMembers]);

  const refresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const applyRange = () => {
    if (!fromDate || !toDate) {
      window.alert("Choisis une date de début et une date de fin.");
      return;
    }
    if (fromDate > toDate) {
      window.alert("La date de début doit être antérieure à la date de fin.");
      return;
    }

    startTransition(() => {
      router.push(`/admin/finances?from=${fromDate}&to=${toDate}`);
    });
  };

  const resetCurrentMonth = () => {
    const currentMonth = getCurrentMonthBounds();
    setFromDate(currentMonth.from);
    setToDate(currentMonth.to);
    startTransition(() => {
      router.push(`/admin/finances?from=${currentMonth.from}&to=${currentMonth.to}`);
    });
  };

  const saveClientRow = async (row: FinanceDashboardRow) => {
    const draft = clientDrafts[row.client_id];
    if (!draft) return;

    setSavingClientId(row.client_id);
    try {
      const response = await fetch("/api/admin/finances/client-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: row.client_id,
          phase: draft.phase,
          trial_amount: draft.trial_amount ? Number(draft.trial_amount) : null,
          trial_start_date: row.finance_profile.trial_start_date,
          trial_end_date: row.finance_profile.trial_end_date,
          mrr_amount: draft.mrr_amount ? Number(draft.mrr_amount) : null,
          next_payment_date: draft.next_payment_date || null,
          last_payment_date: draft.payment_date || row.finance_profile.last_payment_date,
          notes: row.finance_profile.notes,
          payment_entry_id: draft.payment_entry_id,
          payment_amount: draft.payment_amount ? Number(draft.payment_amount) : null,
          payment_date: draft.payment_date || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Impossible de sauvegarder la ligne profit.");
      }

      if (draft.payment_date && !isDateWithinRange(draft.payment_date, from, to)) {
        window.alert("Paiement enregistré hors de la période affichée. Ajuste la plage de dates pour le voir dans le tableau.");
      }

      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setSavingClientId(null);
    }
  };

  const saveExpenseRow = async (entryId: string) => {
    const draft = expenseDrafts[entryId];
    if (!draft) return;

    setSavingExpenseId(entryId);
    try {
      const response = await fetch(`/api/admin/finances/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: draft.client_id || null,
          team_member_id: draft.team_member_id || null,
          entry_type: "expense",
          category: draft.category,
          label: draft.label,
          amount: Number(draft.amount),
          entry_date: draft.entry_date,
          received_by: draft.team_member_id ? getMemberName(teamMembers, draft.team_member_id) : draft.received_by || null,
          notes: draft.notes || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Impossible de sauvegarder la dépense.");
      }

      if (!isDateWithinRange(draft.entry_date, from, to)) {
        window.alert("Dépense enregistrée hors de la période affichée. Ajuste la plage de dates pour l'afficher.");
      }

      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setSavingExpenseId(null);
    }
  };

  const createExpenseRow = async () => {
    setCreatingExpense(true);
    try {
      const response = await fetch("/api/admin/finances/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: newExpenseDraft.client_id || null,
          team_member_id: newExpenseDraft.team_member_id || null,
          entry_type: "expense",
          category: newExpenseDraft.category,
          label: newExpenseDraft.label,
          amount: Number(newExpenseDraft.amount),
          entry_date: newExpenseDraft.entry_date,
          received_by: newExpenseDraft.team_member_id
            ? getMemberName(teamMembers, newExpenseDraft.team_member_id)
            : newExpenseDraft.received_by || null,
          notes: newExpenseDraft.notes || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Impossible d'ajouter la dépense.");
      }

      const outsideVisibleRange = !isDateWithinRange(newExpenseDraft.entry_date, from, to);
      const nextDate = outsideVisibleRange ? newExpenseDraft.entry_date : to;
      setNewExpenseDraft(buildNewExpenseDraft(nextDate, teamMembers));

      if (outsideVisibleRange) {
        window.alert("Dépense enregistrée pour une autre période. Ajuste la plage de dates pour l'afficher dans le tableau.");
      }

      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setCreatingExpense(false);
    }
  };

  const deleteExpenseRow = async (entryId: string) => {
    if (!window.confirm("Supprimer cette dépense ?")) return;

    setDeletingExpenseId(entryId);
    try {
      const response = await fetch(`/api/admin/finances/entries/${entryId}`, {
        method: "DELETE",
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Impossible de supprimer la dépense.");
      }

      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erreur inconnue");
    } finally {
      setDeletingExpenseId(null);
    }
  };

  const showProfits = sectionMode === "all" || sectionMode === "profits";
  const showExpenses = sectionMode === "all" || sectionMode === "expenses";
  const sectionsClassName =
    showProfits && showExpenses ? "grid gap-6 xl:grid-cols-[1.35fr_1fr]" : "grid gap-6";

  return (
    <div className="max-w-[1860px] p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="sticker-yellow -rotate-1 inline-block">FINANCE</div>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-tight">Vue Finance Super Admin</h1>
          <p className="mt-1 text-sm font-medium text-lf-gray">
            Profits clients éditables à gauche, dépenses catégorisées à droite, avec vues tableau, kanban et graphique.
          </p>
        </div>

        <div className="card-brutal-sm flex flex-col gap-3 bg-white p-4 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-xs font-black uppercase tracking-wider text-lf-gray">
            Du
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="input-brutal bg-white text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-black uppercase tracking-wider text-lf-gray">
            Au
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="input-brutal bg-white text-sm" />
          </label>
          <button type="button" onClick={applyRange} className="btn-primary flex items-center gap-2 text-sm">
            <CalendarDays className="h-4 w-4" />
            Appliquer
          </button>
          <button type="button" onClick={resetCurrentMonth} className="btn-secondary text-sm">
            Ce mois
          </button>
          <button type="button" onClick={refresh} className="btn-secondary flex items-center gap-2 text-sm">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Recharger
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <SectionButton active={sectionMode === "all"} label="Tout voir" onClick={() => setSectionMode("all")} />
        <SectionButton active={sectionMode === "profits"} label="Profits uniquement" onClick={() => setSectionMode("profits")} />
        <SectionButton active={sectionMode === "expenses"} label="Dépenses uniquement" onClick={() => setSectionMode("expenses")} />
      </div>

      <div className="mb-6 text-xs font-black uppercase tracking-wider text-lf-gray">
        Période affichée : <span className="text-black">{rangeLabel}</span>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="CA attendu" value={formatCurrency(summary.expected_revenue)} hint={rangeLabel} />
        <StatCard label="Paiements saisis" value={formatCurrency(summary.manual_revenue)} hint="Sommes payées manuellement" accent="bg-lf-green text-white" />
        <StatCard label="Dépenses" value={formatCurrency(summary.total_expenses)} hint={`Ads ${formatCurrency(summary.ad_spend)} · manuel ${formatCurrency(summary.manual_expenses)}`} accent="bg-lf-yellow" />
        <StatCard label="Recurring" value={formatCurrency(summary.recurring_revenue)} hint="MRR actif" accent="bg-lf-blue text-white" />
        <StatCard label="Profit net" value={formatCurrency(summary.net_profit)} hint="Paiements - dépenses" />
        <StatCard label="ROI Ads" value={formatPercent(summary.roi)} hint={`ROAS ${formatMultiplier(summary.roas)}`} />
        <StatCard label="Nouveaux clients" value={String(summary.new_clients_count)} hint="Clients créés sur la période" />
        <StatCard label="Clients suivis" value={String(rows.length)} hint="Lignes profit disponibles" />
      </div>

      {!metaConnected && (
        <div className="card-brutal-sm mb-8 flex items-start gap-3 bg-lf-yellow p-5">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-black uppercase tracking-wide">Données Meta partielles</p>
            <p className="mt-1 text-sm font-medium">
              Le spend publicitaire et le ROI Ads restent à zéro tant que le token Meta ou les comptes pub clients ne sont pas reliés.
            </p>
          </div>
        </div>
      )}

      <div className={sectionsClassName}>
        {showProfits && (
          <section className="card-brutal overflow-hidden">
            <div className="flex items-center justify-between border-b-3 border-black bg-lf-black px-5 py-4 text-white">
              <div>
                <p className="text-sm font-black uppercase tracking-wider">Profits</p>
                <p className="text-xs font-medium text-white/70">
                  Édition directe des montants client, dates de paiement et pilotage trial vs MRR.
                </p>
              </div>
              <span className="text-xs font-black uppercase tracking-wider text-lf-yellow">
                {rows.length} ligne{rows.length > 1 ? "s" : ""}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1480px] w-full">
                <thead className="border-b-3 border-black bg-gray-50 text-left text-xs font-black uppercase tracking-wider text-lf-gray">
                  <tr>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Phase</th>
                    <th className="px-4 py-3">Trial</th>
                    <th className="px-4 py-3">MRR</th>
                    <th className="px-4 py-3">Paiement prévu</th>
                    <th className="px-4 py-3">Somme payée</th>
                    <th className="px-4 py-3">Date payée</th>
                    <th className="px-4 py-3">Attendu</th>
                    <th className="px-4 py-3">CRM CA</th>
                    <th className="px-4 py-3">Ads</th>
                    <th className="px-4 py-3">Charges</th>
                    <th className="px-4 py-3">Profit net</th>
                    <th className="px-4 py-3">ROI Ads</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const draft = clientDrafts[row.client_id];
                    const expected =
                      draft && draft.next_payment_date && isDateWithinRange(draft.next_payment_date, from, to)
                        ? draft.phase === "mrr"
                          ? parseNumber(draft.mrr_amount)
                          : parseNumber(draft.trial_amount)
                        : 0;
                    const paid = draft?.payment_amount ? parseNumber(draft.payment_amount) : 0;
                    const netProfit = paid - (row.manual_expenses + row.ad_spend);

                    return (
                      <tr key={row.client_id} className="border-b-3 border-black bg-white text-sm align-top">
                        <td className="px-4 py-4">
                          <p className="font-black uppercase">{row.client_name}</p>
                          <p className="text-xs font-medium text-lf-gray">{row.contact_name}</p>
                        </td>
                        <td className="px-4 py-4">
                          <select
                            value={draft?.phase ?? "trial"}
                            onChange={(event) =>
                              setClientDrafts((current) => ({
                                ...current,
                                [row.client_id]: {
                                  ...current[row.client_id],
                                  phase: event.target.value as FinancePhase,
                                },
                              }))
                            }
                            className="input-brutal bg-white text-sm"
                          >
                            <option value="trial">Trial</option>
                            <option value="mrr">MRR</option>
                          </select>
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft?.trial_amount ?? ""}
                            onChange={(event) =>
                              setClientDrafts((current) => ({
                                ...current,
                                [row.client_id]: {
                                  ...current[row.client_id],
                                  trial_amount: event.target.value,
                                },
                              }))
                            }
                            className="input-brutal w-28 bg-white text-sm"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft?.mrr_amount ?? ""}
                            onChange={(event) =>
                              setClientDrafts((current) => ({
                                ...current,
                                [row.client_id]: {
                                  ...current[row.client_id],
                                  mrr_amount: event.target.value,
                                },
                              }))
                            }
                            className="input-brutal w-28 bg-white text-sm"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="date"
                            value={draft?.next_payment_date ?? ""}
                            onChange={(event) =>
                              setClientDrafts((current) => ({
                                ...current,
                                [row.client_id]: {
                                  ...current[row.client_id],
                                  next_payment_date: event.target.value,
                                },
                              }))
                            }
                            className="input-brutal bg-white text-sm"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft?.payment_amount ?? ""}
                            onChange={(event) =>
                              setClientDrafts((current) => ({
                                ...current,
                                [row.client_id]: {
                                  ...current[row.client_id],
                                  payment_amount: event.target.value,
                                },
                              }))
                            }
                            className="input-brutal w-28 bg-white text-sm"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="date"
                            value={draft?.payment_date ?? ""}
                            onChange={(event) =>
                              setClientDrafts((current) => ({
                                ...current,
                                [row.client_id]: {
                                  ...current[row.client_id],
                                  payment_date: event.target.value,
                                },
                              }))
                            }
                            className="input-brutal bg-white text-sm"
                          />
                        </td>
                        <td className="px-4 py-4 font-black">{formatCurrency(expected)}</td>
                        <td className="px-4 py-4 font-black">{formatCurrency(row.crm_revenue)}</td>
                        <td className="px-4 py-4 font-black">{formatCurrency(row.ad_spend)}</td>
                        <td className="px-4 py-4 font-black">{formatCurrency(row.manual_expenses)}</td>
                        <td className="px-4 py-4 font-black">{formatCurrency(netProfit)}</td>
                        <td className="px-4 py-4 font-black">{formatPercent(row.roi)}</td>
                        <td className="px-4 py-4">
                          <button
                            type="button"
                            onClick={() => saveClientRow(row)}
                            disabled={savingClientId === row.client_id}
                            className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50"
                          >
                            {savingClientId === row.client_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Sauver
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {showExpenses && (
          <section className="space-y-6">
            <div className="card-brutal overflow-hidden">
              <div className="flex items-center justify-between border-b-3 border-black bg-lf-black px-5 py-4 text-white">
                <div>
                  <p className="text-sm font-black uppercase tracking-wider">Dépenses</p>
                  <p className="text-xs font-medium text-white/70">
                    Catégories normalisées: logiciel, équipe, publicité, autres.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SectionButton active={expenseViewMode === "table"} label="Tableau" onClick={() => setExpenseViewMode("table")} />
                  <SectionButton active={expenseViewMode === "kanban"} label="Kanban" onClick={() => setExpenseViewMode("kanban")} />
                  <SectionButton active={expenseViewMode === "chart"} label="Graphique" onClick={() => setExpenseViewMode("chart")} />
                </div>
              </div>

              <div className="border-b-3 border-black bg-gray-50 px-5 py-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-lf-gray">
                  <Users className="h-4 w-4 text-black" />
                  Équipe disponible automatiquement
                </div>
                <div className="flex flex-wrap gap-2">
                  {teamMembers.map((member) => (
                    <span key={member.id} className="border-2 border-black bg-white px-2 py-1 text-xs font-black uppercase tracking-wider">
                      {member.full_name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
                {(Object.keys(EXPENSE_CATEGORY_META) as ExpenseCategory[]).map((category) => (
                  <StatCard
                    key={category}
                    label={EXPENSE_CATEGORY_META[category].label}
                    value={formatCurrency(expenseTotals[category])}
                    hint="Dépenses sur la période"
                    accent={EXPENSE_CATEGORY_META[category].card}
                  />
                ))}
              </div>
            </div>

            {expenseViewMode === "table" && (
              <div className="card-brutal overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-[1120px] w-full">
                    <thead className="border-b-3 border-black bg-gray-50 text-left text-xs font-black uppercase tracking-wider text-lf-gray">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Équipe</th>
                        <th className="px-4 py-3">Client</th>
                        <th className="px-4 py-3">Catégorie</th>
                        <th className="px-4 py-3">Libellé</th>
                        <th className="px-4 py-3">Montant</th>
                        <th className="px-4 py-3">Notes</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenseEntries.map((entry) => {
                        const draft = expenseDrafts[entry.id];

                        return (
                          <tr key={entry.id} className="border-b-3 border-black bg-white text-sm align-top">
                            <td className="px-4 py-4">
                              <input
                                type="date"
                                value={draft?.entry_date ?? ""}
                                onChange={(event) =>
                                  setExpenseDrafts((current) => ({
                                    ...current,
                                    [entry.id]: {
                                      ...current[entry.id],
                                      entry_date: event.target.value,
                                    },
                                  }))
                                }
                                className="input-brutal bg-white text-sm"
                              />
                            </td>
                            <td className="px-4 py-4">
                              <select
                                value={draft?.team_member_id ?? ""}
                                onChange={(event) =>
                                  setExpenseDrafts((current) => ({
                                    ...current,
                                    [entry.id]: {
                                      ...current[entry.id],
                                      team_member_id: event.target.value,
                                      received_by: getMemberName(teamMembers, event.target.value),
                                    },
                                  }))
                                }
                                className="input-brutal bg-white text-sm"
                              >
                                <option value="">Aucun</option>
                                {teamMembers.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.full_name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-4">
                              <select
                                value={draft?.client_id ?? ""}
                                onChange={(event) =>
                                  setExpenseDrafts((current) => ({
                                    ...current,
                                    [entry.id]: {
                                      ...current[entry.id],
                                      client_id: event.target.value,
                                    },
                                  }))
                                }
                                className="input-brutal bg-white text-sm"
                              >
                                <option value="">Non affecté</option>
                                {rows.map((row) => (
                                  <option key={row.client_id} value={row.client_id}>
                                    {row.client_name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-4">
                              <select
                                value={draft?.category ?? "autres"}
                                onChange={(event) =>
                                  setExpenseDrafts((current) => ({
                                    ...current,
                                    [entry.id]: {
                                      ...current[entry.id],
                                      category: event.target.value as ExpenseCategory,
                                    },
                                  }))
                                }
                                className="input-brutal bg-white text-sm"
                              >
                                {(Object.keys(EXPENSE_CATEGORY_META) as ExpenseCategory[]).map((category) => (
                                  <option key={category} value={category}>
                                    {EXPENSE_CATEGORY_META[category].label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-4">
                              <input
                                type="text"
                                value={draft?.label ?? ""}
                                onChange={(event) =>
                                  setExpenseDrafts((current) => ({
                                    ...current,
                                    [entry.id]: {
                                      ...current[entry.id],
                                      label: event.target.value,
                                    },
                                  }))
                                }
                                className="input-brutal min-w-52 bg-white text-sm"
                              />
                            </td>
                            <td className="px-4 py-4">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft?.amount ?? ""}
                                onChange={(event) =>
                                  setExpenseDrafts((current) => ({
                                    ...current,
                                    [entry.id]: {
                                      ...current[entry.id],
                                      amount: event.target.value,
                                    },
                                  }))
                                }
                                className="input-brutal w-28 bg-white text-sm"
                              />
                            </td>
                            <td className="px-4 py-4">
                              <input
                                type="text"
                                value={draft?.notes ?? ""}
                                onChange={(event) =>
                                  setExpenseDrafts((current) => ({
                                    ...current,
                                    [entry.id]: {
                                      ...current[entry.id],
                                      notes: event.target.value,
                                    },
                                  }))
                                }
                                className="input-brutal min-w-44 bg-white text-sm"
                              />
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveExpenseRow(entry.id)}
                                  disabled={savingExpenseId === entry.id}
                                  className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50"
                                >
                                  {savingExpenseId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                  Sauver
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteExpenseRow(entry.id)}
                                  disabled={deletingExpenseId === entry.id}
                                  className="inline-flex items-center gap-1 border-2 border-red-500 px-3 py-2 text-xs font-black uppercase tracking-wider text-red-600 disabled:opacity-50"
                                >
                                  {deletingExpenseId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                  Suppr.
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                      <tr className="border-t-3 border-black bg-lf-yellow/20 text-sm align-top">
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-2">
                            <input
                              type="date"
                              value={newExpenseDraft.entry_date}
                              onChange={(event) => setNewExpenseDraft((current) => ({ ...current, entry_date: event.target.value }))}
                              className="input-brutal bg-white text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => setNewExpenseDraft((current) => ({ ...current, entry_date: getNextMonthStart(to) }))}
                              className="text-left text-[11px] font-black uppercase tracking-wider text-lf-blue"
                            >
                              Mois prochain
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <select
                            value={newExpenseDraft.team_member_id}
                            onChange={(event) =>
                              setNewExpenseDraft((current) => ({
                                ...current,
                                team_member_id: event.target.value,
                                received_by: getMemberName(teamMembers, event.target.value),
                              }))
                            }
                            className="input-brutal bg-white text-sm"
                          >
                            <option value="">Aucun</option>
                            {teamMembers.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.full_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-4">
                          <select
                            value={newExpenseDraft.client_id}
                            onChange={(event) => setNewExpenseDraft((current) => ({ ...current, client_id: event.target.value }))}
                            className="input-brutal bg-white text-sm"
                          >
                            <option value="">Non affecté</option>
                            {rows.map((row) => (
                              <option key={row.client_id} value={row.client_id}>
                                {row.client_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-4">
                          <select
                            value={newExpenseDraft.category}
                            onChange={(event) => setNewExpenseDraft((current) => ({ ...current, category: event.target.value as ExpenseCategory }))}
                            className="input-brutal bg-white text-sm"
                          >
                            {(Object.keys(EXPENSE_CATEGORY_META) as ExpenseCategory[]).map((category) => (
                              <option key={category} value={category}>
                                {EXPENSE_CATEGORY_META[category].label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="text"
                            value={newExpenseDraft.label}
                            onChange={(event) => setNewExpenseDraft((current) => ({ ...current, label: event.target.value }))}
                            className="input-brutal min-w-52 bg-white text-sm"
                            placeholder="Nouvelle dépense"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={newExpenseDraft.amount}
                            onChange={(event) => setNewExpenseDraft((current) => ({ ...current, amount: event.target.value }))}
                            className="input-brutal w-28 bg-white text-sm"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            type="text"
                            value={newExpenseDraft.notes}
                            onChange={(event) => setNewExpenseDraft((current) => ({ ...current, notes: event.target.value }))}
                            className="input-brutal min-w-44 bg-white text-sm"
                            placeholder="Commentaire"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <button
                            type="button"
                            onClick={createExpenseRow}
                            disabled={creatingExpense}
                            className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50"
                          >
                            {creatingExpense ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Ajouter
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="border-t-3 border-black bg-gray-50 px-5 py-4 text-xs font-bold uppercase tracking-wider text-lf-gray">
                  Dépenses non affectées : <span className="text-black">{formatCurrency(summary.unassigned_expenses)}</span>
                </div>
              </div>
            )}

            {expenseViewMode === "kanban" && (
              <ExpenseKanban totals={expenseTotals} cards={expenseCards} />
            )}

            {expenseViewMode === "chart" && (
              <ExpenseDonut totals={expenseTotals} />
            )}
          </section>
        )}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="CRM CA" value={formatCurrency(summary.crm_revenue)} hint="CA remonté depuis les leads" />
        <StatCard label="Ads ROI" value={formatPercent(summary.roi)} hint={`ROAS ${formatMultiplier(summary.roas)}`} />
        <StatCard label="Équipe active" value={String(teamMembers.length)} hint="Admins visibles dans les dépenses" />
        <StatCard label="Marge" value={formatCurrency(summary.margin)} hint="Attendu - dépenses" />
      </div>
    </div>
  );
}
