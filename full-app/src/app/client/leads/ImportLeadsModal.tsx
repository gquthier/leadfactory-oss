"use client";

import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { Upload, FileText, AlertTriangle, Check, X, Trash2 } from "lucide-react";

interface Props {
  onImport: (file: File) => Promise<{ imported: number; duplicates: number; errors: string[] }>;
  onClose: () => void;
}

type Step = "upload" | "preview" | "result";

// ── Column mapping ────────────────────────────────────────────────────────────

const COLUMN_MAP: Record<string, keyof ParsedRow> = {
  nom: "full_name",
  name: "full_name",
  full_name: "full_name",
  "nom complet": "full_name",
  email: "email",
  "e-mail": "email",
  téléphone: "phone",
  telephone: "phone",
  phone: "phone",
  tel: "phone",
  mobile: "phone",
  entreprise: "company",
  company: "company",
  société: "company",
  societe: "company",
  source: "source",
  notes: "notes",
  note: "notes",
  ville: "city",
  city: "city",
};

interface ParsedRow {
  full_name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  notes: string;
  city: string;
}

interface ParseResult {
  headers: string[];
  mappedHeaders: Array<{ original: string; mapped: keyof ParsedRow | null }>;
  rows: ParsedRow[];
  totalRows: number;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseCSV(text: string): ParseResult {
  // Detect delimiter: semicolon or comma
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delimiter = firstLine.split(";").length >= firstLine.split(",").length ? ";" : ",";

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { headers: [], mappedHeaders: [], rows: [], totalRows: 0 };
  }

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const rawHeaders = parseRow(lines[0]);
  const mappedHeaders: ParseResult["mappedHeaders"] = rawHeaders.map((h) => ({
    original: h,
    mapped: (COLUMN_MAP[normalize(h)] as keyof ParsedRow) ?? null,
  }));

  const dataLines = lines.slice(1);
  const totalRows = dataLines.length;

  const rows: ParsedRow[] = dataLines.map((line) => {
    const cells = parseRow(line);
    const row: ParsedRow = {
      full_name: "",
      email: "",
      phone: "",
      company: "",
      source: "",
      notes: "",
      city: "",
    };
    mappedHeaders.forEach(({ mapped }, idx) => {
      if (mapped) {
        row[mapped] = cells[idx] ?? "";
      }
    });
    return row;
  });

  return { headers: rawHeaders, mappedHeaders, rows, totalRows };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

// ── Field label map for table display ────────────────────────────────────────
const FIELD_LABELS: Record<keyof ParsedRow, string> = {
  full_name: "Nom",
  email: "Email",
  phone: "Téléphone",
  company: "Entreprise",
  source: "Source",
  notes: "Notes",
  city: "Ville",
};

// ── Component ────────────────────────────────────────────────────────────────

export function ImportLeadsModal({ onImport, onClose }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ imported: number; duplicates: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    if (!f.name.endsWith(".csv")) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      setParseResult(parsed);
      setStep("preview");
    };
    reader.readAsText(f, "UTF-8");
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  }

  function handleRemoveFile() {
    setFile(null);
    setParseResult(null);
    setStep("upload");
  }

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    setProgress(0);

    // Simulate progress ticks while waiting
    const timer = setInterval(() => {
      setProgress((p) => Math.min(p + 12, 88));
    }, 250);

    try {
      const res = await onImport(file);
      clearInterval(timer);
      setProgress(100);
      setResult(res);
      setStep("result");
    } catch {
      clearInterval(timer);
      setResult({ imported: 0, duplicates: 0, errors: ["Une erreur inattendue s'est produite."] });
      setStep("result");
    } finally {
      setLoading(false);
    }
  }

  // Displayed columns in preview table (only mapped ones)
  const previewColumns: Array<keyof ParsedRow> =
    parseResult
      ? (parseResult.mappedHeaders
          .filter((h) => h.mapped !== null)
          .map((h) => h.mapped as keyof ParsedRow)
          .filter((v, i, arr) => arr.indexOf(v) === i))
      : [];

  const previewRows = parseResult?.rows.slice(0, 5) ?? [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-canvas border-3 border-black shadow-brutal w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-3 border-black flex-none">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            <h2 className="font-black uppercase tracking-tight text-base">Importer des leads — CSV</h2>
          </div>
          <button onClick={onClose} type="button" className="hover:bg-lf-pink p-1 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b-3 border-black flex-none">
          {(["upload", "preview", "result"] as Step[]).map((s, i) => {
            const labels = ["1. Fichier", "2. Aperçu", "3. Résultat"];
            const active = s === step;
            const done =
              (s === "upload" && (step === "preview" || step === "result")) ||
              (s === "preview" && step === "result");
            return (
              <div
                key={s}
                className={`flex-1 px-4 py-2 text-xs font-black uppercase tracking-wide text-center border-r-3 border-black last:border-r-0 ${
                  active
                    ? "bg-lf-black text-white"
                    : done
                    ? "bg-lf-green/20 text-lf-black"
                    : "bg-white text-gray-400"
                }`}
              >
                {done ? (
                  <span className="flex items-center justify-center gap-1">
                    <Check className="w-3.5 h-3.5" /> {labels[i]}
                  </span>
                ) : (
                  labels[i]
                )}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-4">

          {/* ── Step 1: Upload ── */}
          {step === "upload" && (
            <div className="space-y-4">
              {/* Info text */}
              <div className="text-xs text-gray-500 font-bold border-3 border-dashed border-gray-300 px-4 py-3 space-y-1">
                <p>Colonnes supportées : <span className="text-lf-black">Nom, Email, Téléphone, Entreprise, Source, Ville, Notes</span></p>
                <p>Séparez par virgule ou point-virgule.</p>
              </div>

              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`border-3 border-dashed cursor-pointer flex flex-col items-center justify-center gap-3 py-14 transition-colors ${
                  dragging
                    ? "border-lf-blue bg-lf-blue/5"
                    : "border-black hover:border-lf-blue hover:bg-lf-blue/5"
                }`}
              >
                <Upload className={`w-10 h-10 ${dragging ? "text-lf-blue" : "text-gray-400"}`} />
                <div className="text-center">
                  <p className="font-black uppercase text-sm">
                    {dragging ? "Relâchez pour importer" : "Glissez votre fichier CSV ici"}
                  </p>
                  <p className="text-xs text-gray-500 font-medium mt-1">ou cliquez pour parcourir</p>
                </div>
                <span className="text-xs text-gray-400 font-bold uppercase tracking-wide border border-gray-300 px-2 py-0.5">
                  .CSV uniquement
                </span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleInputChange}
                className="hidden"
              />
            </div>
          )}

          {/* ── Step 2: Preview ── */}
          {step === "preview" && parseResult && file && (
            <div className="space-y-4">
              {/* File info */}
              <div className="flex items-center justify-between border-3 border-black p-3 bg-white shadow-brutal">
                <div className="flex items-center gap-3">
                  <FileText className="w-6 h-6 text-lf-blue flex-none" />
                  <div>
                    <p className="font-black text-sm">{file.name}</p>
                    <p className="text-xs text-gray-500 font-medium">{formatBytes(file.size)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveFile}
                  className="flex items-center gap-1.5 text-xs font-black uppercase text-red-500 border-2 border-red-500 px-3 py-1.5 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Supprimer
                </button>
              </div>

              {/* Row count */}
              <div className="flex items-center gap-2 font-black text-sm">
                <span className="bg-lf-green text-white px-2 py-0.5 border border-black text-xs uppercase">
                  {parseResult.totalRows} lead{parseResult.totalRows !== 1 ? "s" : ""} détecté{parseResult.totalRows !== 1 ? "s" : ""}
                </span>
                <span className="text-gray-500 font-medium text-xs">
                  {parseResult.mappedHeaders.filter((h) => h.mapped).length} colonne{parseResult.mappedHeaders.filter((h) => h.mapped).length !== 1 ? "s" : ""} reconnue{parseResult.mappedHeaders.filter((h) => h.mapped).length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Column mapping */}
              <div>
                <p className="text-xs font-black uppercase tracking-wide mb-2">Correspondance des colonnes</p>
                <div className="flex flex-wrap gap-2">
                  {parseResult.mappedHeaders.map(({ original, mapped }) => (
                    <div
                      key={original}
                      className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 border-2 ${
                        mapped
                          ? "border-lf-green bg-lf-green/10"
                          : "border-gray-300 bg-gray-100 text-gray-400"
                      }`}
                    >
                      <span>{original}</span>
                      {mapped ? (
                        <>
                          <span className="text-gray-400">→</span>
                          <span className="text-lf-green font-black">{FIELD_LABELS[mapped]}</span>
                          <Check className="w-3 h-3 text-lf-green" />
                        </>
                      ) : (
                        <span className="text-gray-400">(ignoré)</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview table */}
              {previewColumns.length > 0 && previewRows.length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-wide mb-2">
                    Aperçu — {Math.min(5, parseResult.totalRows)} première{Math.min(5, parseResult.totalRows) !== 1 ? "s" : ""} ligne{Math.min(5, parseResult.totalRows) !== 1 ? "s" : ""}
                  </p>
                  <div className="overflow-x-auto border-3 border-black">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-lf-black text-white">
                          {previewColumns.map((col) => (
                            <th key={col} className="px-3 py-2 text-left font-black uppercase tracking-wide border-r border-white/20 last:border-r-0 whitespace-nowrap">
                              {FIELD_LABELS[col]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} className={`border-t border-black/10 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                            {previewColumns.map((col) => (
                              <td key={col} className="px-3 py-2 font-medium border-r border-black/10 last:border-r-0 max-w-[160px] truncate">
                                {row[col] || <span className="text-gray-300">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parseResult.totalRows > 5 && (
                    <p className="text-xs text-gray-400 font-medium mt-1">
                      + {parseResult.totalRows - 5} ligne{parseResult.totalRows - 5 !== 1 ? "s" : ""} supplémentaire{parseResult.totalRows - 5 !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              )}

              {/* No recognized columns */}
              {previewColumns.length === 0 && (
                <div className="flex items-center gap-2 bg-lf-yellow border-3 border-black p-3">
                  <AlertTriangle className="w-5 h-5 flex-none" />
                  <p className="text-sm font-bold">
                    Aucune colonne reconnue. Vérifiez les en-têtes : Nom, Email, Téléphone, Entreprise, Source, Ville, Notes.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Result ── */}
          {step === "result" && result && (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="border-3 border-black p-4 bg-lf-green text-white shadow-brutal">
                  <p className="text-xs font-black uppercase tracking-wide opacity-80">Leads importés</p>
                  <p className="text-4xl font-black mt-1">{result.imported}</p>
                </div>
                <div className="border-3 border-black p-4 bg-lf-yellow shadow-brutal">
                  <p className="text-xs font-black uppercase tracking-wide">Doublons ignorés</p>
                  <p className="text-4xl font-black mt-1">{result.duplicates}</p>
                </div>
              </div>

              {/* Success message */}
              {result.errors.length === 0 && (
                <div className="flex items-center gap-2 border-3 border-lf-green bg-lf-green/10 p-3">
                  <Check className="w-5 h-5 text-lf-green flex-none" />
                  <p className="text-sm font-black">
                    {result.imported} lead{result.imported !== 1 ? "s" : ""} importé{result.imported !== 1 ? "s" : ""} avec succès
                    {result.duplicates > 0 && `, ${result.duplicates} doublon${result.duplicates !== 1 ? "s" : ""} ignoré${result.duplicates !== 1 ? "s" : ""}`}.
                  </p>
                </div>
              )}

              {/* Errors */}
              {result.errors.length > 0 && (
                <div className="border-3 border-red-500 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-red-500">
                    <AlertTriangle className="w-4 h-4" />
                    <p className="text-xs font-black uppercase tracking-wide">
                      {result.errors.length} erreur{result.errors.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <ul className="space-y-1 max-h-36 overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <li key={i} className="text-xs text-red-600 font-medium flex items-start gap-1.5">
                        <span className="mt-0.5 flex-none">—</span>
                        {err}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Progress bar (during import) */}
          {loading && (
            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-wide">Import en cours…</p>
              <div className="w-full bg-gray-100 border-3 border-black h-6 relative overflow-hidden">
                <div
                  className="h-full bg-lf-blue transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-xs font-black">
                  {progress}%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t-3 border-black flex-none">
          {step === "upload" && (
            <button type="button" onClick={onClose} className="btn-secondary text-sm w-full">
              Annuler
            </button>
          )}

          {step === "preview" && (
            <>
              <button
                type="button"
                onClick={handleImport}
                disabled={loading || previewColumns.length === 0 || (parseResult?.totalRows ?? 0) === 0}
                className="btn-primary flex items-center gap-2 flex-1 justify-center text-sm"
              >
                {loading ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Import en cours…
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Importer {parseResult?.totalRows ?? 0} lead{(parseResult?.totalRows ?? 0) !== 1 ? "s" : ""}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleRemoveFile}
                disabled={loading}
                className="btn-secondary text-sm"
              >
                Retour
              </button>
            </>
          )}

          {step === "result" && (
            <button type="button" onClick={onClose} className="btn-primary flex items-center gap-2 flex-1 justify-center text-sm">
              <Check className="w-4 h-4" />
              Fermer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
