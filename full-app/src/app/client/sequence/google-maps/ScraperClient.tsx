"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Download,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  CreateJobRequest,
  ScrapeJob,
  ScrapeJobOptions,
} from "@/types/scraper";

interface Props {
  initialJobs: ScrapeJob[];
}

const URL_REGEX = /^https?:\/\/(www\.|maps\.)?google\.[a-z.]+\/maps\//i;
const MAX_RESULTS_OPTIONS = [100, 250, 500, 1000, 2000];
const DEFAULT_FORM: { url: string; maxResults: number; enrichEmails: boolean } = {
  url: "",
  maxResults: 500,
  enrichEmails: false,
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  let diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 5) return "à l'instant";
  if (diff < 60) return `il y a ${diff}s`;
  const m = Math.floor(diff / 60);
  diff -= m * 60;
  if (m < 60) return diff > 0 ? `il y a ${m}m${diff}s` : `il y a ${m}m`;
  const h = Math.floor(m / 60);
  const remM = m - h * 60;
  if (h < 24) return remM > 0 ? `il y a ${h}h${remM}m` : `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mn = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mn}`;
}

function extractSearchQuery(url: string): string {
  try {
    const m = url.match(/\/search\/([^/?]+)/);
    if (!m) return "Google Maps";
    const decoded = decodeURIComponent(m[1]).replace(/\+/g, " ");
    return decoded.length > 40 ? `${decoded.slice(0, 40)}…` : decoded;
  } catch {
    return "Google Maps";
  }
}

interface StatusMeta {
  label: string;
  color: string;
  icon: LucideIcon;
  spin: boolean;
}

function formatStatus(s: ScrapeJob["status"]): StatusMeta {
  switch (s) {
    case "queued":
      return { label: "En attente", color: "text-gray-500", icon: Loader2, spin: true };
    case "running":
      return { label: "En cours", color: "text-lf-blue", icon: Loader2, spin: true };
    case "done":
      return { label: "Terminé", color: "text-lf-green", icon: Check, spin: false };
    case "failed":
      return { label: "Échoué", color: "text-red-500", icon: AlertCircle, spin: false };
    case "cancelled":
      return { label: "Annulé", color: "text-gray-500", icon: X, spin: false };
  }
}

function isTerminal(s: ScrapeJob["status"]): boolean {
  return s === "done" || s === "failed" || s === "cancelled";
}

export function ScraperClient({ initialJobs }: Props) {
  const [jobs, setJobs] = useState<ScrapeJob[]>(initialJobs);
  const [currentJob, setCurrentJob] = useState<ScrapeJob | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [, forceTick] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const urlValid = useMemo(() => URL_REGEX.test(form.url.trim()), [form.url]);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/client/scraper/jobs?limit=20", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs?: ScrapeJob[] };
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
    } catch {
      /* swallow */
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const res = await fetch(`/api/client/scraper/jobs/${jobId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { job?: ScrapeJob };
        if (!data.job) return;
        setCurrentJob(data.job);
        if (isTerminal(data.job.status)) {
          stopPolling();
          refreshHistory();
        }
      } catch {
        /* swallow */
      }
    },
    [refreshHistory, stopPolling],
  );

  useEffect(() => {
    if (!currentJob) return;
    if (isTerminal(currentJob.status)) return;
    if (pollRef.current) return;
    pollRef.current = setInterval(() => pollJob(currentJob.id), 2000);
    return () => stopPolling();
  }, [currentJob, pollJob, stopPolling]);

  useEffect(() => {
    historyRef.current = setInterval(() => refreshHistory(), 30000);
    return () => {
      if (historyRef.current) clearInterval(historyRef.current);
    };
  }, [refreshHistory]);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!urlValid || submitting) return;
    setError(null);
    setSubmitting(true);

    const optimistic: ScrapeJob = {
      id: `optimistic-${Date.now()}`,
      client_id: "",
      source: "google_maps",
      input_url: form.url.trim(),
      input_options: {
        maxResults: form.maxResults,
        enrichEmails: form.enrichEmails,
      } satisfies ScrapeJobOptions,
      apify_run_id: null,
      apify_dataset_id: null,
      status: "queued",
      progress_pct: 0,
      results_count: 0,
      cost_usd: null,
      csv_storage_path: null,
      error_message: null,
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
    };
    setCurrentJob(optimistic);

    try {
      const body: CreateJobRequest = {
        url: form.url.trim(),
        maxResults: form.maxResults,
        enrichEmails: form.enrichEmails,
      };
      const res = await fetch("/api/client/scraper/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { job?: ScrapeJob; error?: string };
      if (!res.ok || !data.job) {
        setCurrentJob(null);
        setError(data.error ?? "Impossible de lancer le scrape.");
        return;
      }
      setCurrentJob(data.job);
      refreshHistory();
    } catch {
      setCurrentJob(null);
      setError("Erreur réseau. Réessaie.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!currentJob) return;
    if (currentJob.id.startsWith("optimistic-")) return;
    try {
      const res = await fetch(`/api/client/scraper/jobs/${currentJob.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setCurrentJob({ ...currentJob, status: "cancelled" });
        stopPolling();
        refreshHistory();
      }
    } catch {
      /* swallow */
    }
  }

  function handleDownload(jobId: string) {
    window.open(`/api/client/scraper/jobs/${jobId}/csv`, "_blank");
  }

  function handleReset() {
    setCurrentJob(null);
    setError(null);
    setForm(DEFAULT_FORM);
    stopPolling();
  }

  const showForm = !currentJob || (currentJob.status === "cancelled");
  const showRunning =
    currentJob &&
    (currentJob.status === "queued" || currentJob.status === "running");
  const showDone = currentJob && currentJob.status === "done";
  const showFailed = currentJob && currentJob.status === "failed";

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs font-black uppercase tracking-wide mb-4">
        <Link
          href="/client/sequence"
          className="flex items-center gap-1 text-lf-gray hover:text-lf-black transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Outbound
        </Link>
        <span className="text-lf-gray">/</span>
        <span className="text-lf-black">Scraping Google Maps</span>
      </nav>

      {/* Title */}
      <div className="mb-8">
        <div className="sticker-yellow -rotate-1 inline-block mb-3">
          GOOGLE MAPS
        </div>
        <h1 className="text-3xl font-black uppercase tracking-tight">
          Scraping Google Maps
        </h1>
        <p className="text-lf-gray font-medium mt-2">
          Colle un lien Google Maps et reçois un CSV de leads prêts pour le
          cold call.
        </p>
      </div>

      {/* Active card slot */}
      {showRunning && currentJob && (
        <RunningCard
          job={currentJob}
          maxResults={currentJob.input_options?.maxResults ?? form.maxResults}
          onCancel={handleCancel}
        />
      )}

      {showDone && currentJob && (
        <DoneCard
          job={currentJob}
          onDownload={() => handleDownload(currentJob.id)}
          onReset={handleReset}
        />
      )}

      {showFailed && currentJob && (
        <FailedCard
          message={currentJob.error_message ?? "Le scrape a échoué."}
          onReset={handleReset}
        />
      )}

      {showForm && (
        <FormCard
          form={form}
          setForm={setForm}
          urlValid={urlValid}
          submitting={submitting}
          error={error}
          onSubmit={handleSubmit}
        />
      )}

      {/* History */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black uppercase tracking-wide">
            Vos derniers scrapes
          </h2>
          <button
            type="button"
            onClick={refreshHistory}
            className="flex items-center gap-1.5 text-xs font-black uppercase text-lf-gray hover:text-lf-black transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualiser
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="border-3 border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm font-bold text-lf-gray">
              Aucun scrape pour le moment.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <HistoryRow
                key={job.id}
                job={job}
                onDownload={() => handleDownload(job.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ── Subcomponents ─────────────────────────────────────────────── */

interface FormCardProps {
  form: typeof DEFAULT_FORM;
  setForm: (f: typeof DEFAULT_FORM) => void;
  urlValid: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

function FormCard({
  form,
  setForm,
  urlValid,
  submitting,
  error,
  onSubmit,
}: FormCardProps) {
  return (
    <form onSubmit={onSubmit} className="card-brutal p-6 space-y-5">
      {/* URL */}
      <div>
        <label className="block text-xs font-black uppercase tracking-wide mb-2">
          Lien Google Maps <span className="text-red-500">*</span>
        </label>
        <input
          type="url"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          placeholder="https://www.google.com/maps/search/…"
          className={clsx(
            "w-full border-3 px-3 py-2.5 font-medium text-sm focus:outline-none transition-colors bg-white",
            form.url.length === 0
              ? "border-black"
              : urlValid
                ? "border-lf-green"
                : "border-red-500",
          )}
        />
        <p className="text-xs text-lf-gray font-medium mt-1.5">
          Astuce&nbsp;: fais ta recherche sur Google Maps, puis copie l&apos;URL
          depuis la barre d&apos;adresse.
        </p>
      </div>

      {/* Max results */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-black uppercase tracking-wide">
            Nombre de résultats max
          </label>
          <span className="text-xs text-lf-gray font-medium">
            Par défaut&nbsp;: 500
          </span>
        </div>
        <select
          value={form.maxResults}
          onChange={(e) =>
            setForm({ ...form, maxResults: Number(e.target.value) })
          }
          className="w-full border-3 border-black px-3 py-2.5 font-bold text-sm bg-white focus:outline-none"
        >
          {MAX_RESULTS_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} résultats
            </option>
          ))}
        </select>
      </div>

      {/* Enrich toggle */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={form.enrichEmails}
          onChange={(e) =>
            setForm({ ...form, enrichEmails: e.target.checked })
          }
          className="mt-1 w-5 h-5 border-3 border-black accent-lf-blue cursor-pointer"
        />
        <div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-lf-yellow" />
            <span className="text-sm font-black">
              Enrichir avec emails depuis les sites web
            </span>
          </div>
          <p className="text-xs text-lf-gray font-medium mt-0.5">
            ~30 sec de plus par tranche de 100 résultats.
          </p>
        </div>
      </label>

      {error && (
        <div className="flex items-center gap-2 border-3 border-red-500 bg-red-50 p-3">
          <AlertCircle className="w-4 h-4 text-red-500 flex-none" />
          <p className="text-sm font-bold text-red-600">{error}</p>
        </div>
      )}

      {/* Submit */}
      <div className="flex justify-end pt-2 border-t-3 border-black">
        <button
          type="submit"
          disabled={!urlValid || submitting}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Lancement…
            </>
          ) : (
            <>
              <MapPin className="w-4 h-4" />
              Lancer le scrape
            </>
          )}
        </button>
      </div>
    </form>
  );
}

interface RunningCardProps {
  job: ScrapeJob;
  maxResults: number;
  onCancel: () => void;
}

function RunningCard({ job, maxResults, onCancel }: RunningCardProps) {
  const pct = Math.max(0, Math.min(100, job.progress_pct ?? 0));
  const truncatedUrl =
    job.input_url.length > 60
      ? `${job.input_url.slice(0, 60)}…`
      : job.input_url;
  return (
    <div className="card-brutal p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-lf-blue" />
        <h3 className="text-lg font-black uppercase tracking-tight">
          Extraction en cours…
        </h3>
      </div>

      <div className="w-full bg-gray-100 border-3 border-black h-6 relative overflow-hidden">
        <div
          className="h-full bg-lf-blue transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-xs font-black">
          {pct}%
        </span>
      </div>

      <div className="text-sm font-bold">
        {job.results_count} / {maxResults} leads
        <span className="text-lf-gray font-medium">
          {" "}
          · démarré {formatRelativeTime(job.started_at ?? job.created_at)}
        </span>
      </div>

      <p className="text-xs text-lf-gray font-medium truncate">
        {truncatedUrl}
      </p>

      <div className="flex justify-end pt-2 border-t-3 border-black">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <X className="w-4 h-4" />
          Annuler
        </button>
      </div>
    </div>
  );
}

interface DoneCardProps {
  job: ScrapeJob;
  onDownload: () => void;
  onReset: () => void;
}

function DoneCard({ job, onDownload, onReset }: DoneCardProps) {
  return (
    <div className="card-brutal p-6 space-y-4 bg-lf-green/10">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 border-3 border-black rounded-full bg-lf-green flex items-center justify-center shadow-brutal-xs">
          <Check className="w-4 h-4 text-white" strokeWidth={3} />
        </div>
        <h3 className="text-lg font-black uppercase tracking-tight">
          {job.results_count} leads extraits
        </h3>
      </div>

      <div className="text-sm font-bold">
        Coût&nbsp;:{" "}
        <span className="text-lf-black">
          ${(job.cost_usd ?? 0).toFixed(2)}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t-3 border-black">
        <button
          type="button"
          onClick={onDownload}
          className="btn-primary flex items-center gap-2 text-sm justify-center"
        >
          <Download className="w-4 h-4" />
          Télécharger le CSV
        </button>
        <button
          type="button"
          onClick={onReset}
          className="btn-secondary flex items-center gap-2 text-sm justify-center"
        >
          <RefreshCw className="w-4 h-4" />
          Lancer un autre scrape
        </button>
      </div>
    </div>
  );
}

function FailedCard({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}) {
  return (
    <div className="card-brutal p-6 space-y-4 bg-red-50 border-red-500">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-6 h-6 text-red-500" />
        <h3 className="text-lg font-black uppercase tracking-tight text-red-600">
          Le scrape a échoué
        </h3>
      </div>
      <p className="text-sm font-bold text-red-700">{message}</p>
      <div className="flex justify-end pt-2 border-t-3 border-red-500">
        <button
          type="button"
          onClick={onReset}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Réessayer
        </button>
      </div>
    </div>
  );
}

function HistoryRow({
  job,
  onDownload,
}: {
  job: ScrapeJob;
  onDownload: () => void;
}) {
  const status = formatStatus(job.status);
  const StatusIcon = status.icon;
  const query = extractSearchQuery(job.input_url);
  return (
    <li className="border-3 border-black bg-white shadow-brutal-xs p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:shadow-brutal transition-shadow">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <MapPin className="w-4 h-4 text-lf-yellow flex-none" />
          <p className="font-black text-sm truncate">{query}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-lf-gray">
          <span className="font-bold text-lf-black">
            {job.results_count} leads
          </span>
          <span>{formatDate(job.created_at)}</span>
          <span className={clsx("flex items-center gap-1 font-bold", status.color)}>
            <StatusIcon
              className={clsx("w-3.5 h-3.5", status.spin && "animate-spin")}
            />
            {status.label}
          </span>
        </div>
      </div>
      {job.status === "done" && (
        <button
          type="button"
          onClick={onDownload}
          className="btn-secondary flex items-center gap-1.5 text-xs whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          Télécharger CSV
        </button>
      )}
    </li>
  );
}
