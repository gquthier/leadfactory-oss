import path from "path";
import fs from "fs/promises";

/** Livrables locaux : dossier dédié explicitement choisi par l’utilisateur. */
export const DELIVERABLES_ROOT = process.env.LF_DELIVERABLES_DIR?.trim() || null;

function configuredRoot(): string | null {
  return DELIVERABLES_ROOT && path.isAbsolute(DELIVERABLES_ROOT)
    ? path.resolve(DELIVERABLES_ROOT)
    : null;
}

export type DeliverableType =
  | "onboarding_form"
  | "deep_search_market_awareness"
  | "deep_search_competitor_research"
  | "deep_search_psychographic"
  | "competitor_ads_brief"
  | "competitor_ads_data"
  | "competitor_ads_analysis"
  | "competitor_ads_creative"
  | "campaign_proposal"
  | "vsl_script"
  | "vsl_strategy"
  | "vsl_docx"
  | "meta_ads_copy"
  | "meta_ads_docx"
  | "readme_index"
  | "other";

export type ScannedFile = {
  relativePath: string;
  absolutePath: string;
  deliverableType: DeliverableType;
  deliverableName: string;
  fileExtension: string;
  fileSizeBytes: number;
  generatedAt: string;
};

/**
 * Slugify un nom client pour matcher avec les noms de dossiers locaux.
 * Exemple fictif : "Entreprise Démo" → "entreprise-demo".
 */
export function slugifyClientName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Cherche le dossier local correspondant \u00e0 un client.
 * Tente plusieurs variantes de slug.
 */
export async function findClientFolder(clientName: string): Promise<string | null> {
  const projectsRoot = configuredRoot();
  if (!projectsRoot) return null;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(projectsRoot);
  } catch {
    return null;
  }

  const slug = slugifyClientName(clientName);
  const variants = new Set<string>([
    clientName,
    clientName.toLowerCase(),
    slug,
    slug.replace(/-/g, "_"),
    slug.replace(/-/g, " "),
    slug.replace(/-/g, ""),
  ]);

  for (const entry of entries) {
    const entrySlug = slugifyClientName(entry);
    if (variants.has(entry) || entrySlug === slug) {
      const candidate = path.join(projectsRoot, entry);
      const realRoot = await fs.realpath(projectsRoot);
      const realCandidate = await fs.realpath(candidate);
      if (!realCandidate.startsWith(realRoot + path.sep)) continue;
      if (!(await fs.lstat(candidate)).isDirectory()) continue;
      return candidate;
    }
  }
  return null;
}

/**
 * D\u00e9duit le type de livrable depuis le chemin relatif.
 */
export function inferDeliverableType(relativePath: string): DeliverableType {
  const p = relativePath.toLowerCase();

  if (p.includes("00-onboarding")) return "onboarding_form";

  if (p.includes("01-deep-search")) {
    if (p.includes("market")) return "deep_search_market_awareness";
    if (p.includes("competitor")) return "deep_search_competitor_research";
    if (p.includes("psycho")) return "deep_search_psychographic";
    return "deep_search_market_awareness";
  }

  if (p.includes("02-competitor-ads")) {
    if (p.includes("creatives/")) return "competitor_ads_creative";
    if (p.endsWith(".csv")) return "competitor_ads_data";
    if (p.endsWith(".docx")) return "competitor_ads_brief";
    if (p.endsWith(".md")) return "competitor_ads_analysis";
    return "competitor_ads_brief";
  }

  if (p.includes("03-campaign-proposal")) return "campaign_proposal";

  if (p.includes("04-vsl")) {
    if (p.endsWith(".docx")) return "vsl_docx";
    if (p.includes("strategy")) return "vsl_strategy";
    return "vsl_script";
  }

  if (p.includes("05-meta-ads")) {
    if (p.endsWith(".docx")) return "meta_ads_docx";
    return "meta_ads_copy";
  }

  if (p.toLowerCase().endsWith("readme.md")) return "readme_index";

  return "other";
}

/**
 * Scanne r\u00e9cursivement un dossier et retourne tous les fichiers exploitables.
 */
export async function scanClientFolder(clientFolderAbs: string): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  const projectsRoot = configuredRoot();
  if (!projectsRoot || !isPathSafe(clientFolderAbs)) return results;
  const realRoot = await fs.realpath(projectsRoot).catch(() => null);
  const realClient = await fs.realpath(clientFolderAbs).catch(() => null);
  if (!realRoot || !realClient || !realClient.startsWith(realRoot + path.sep)) return results;

  async function walk(dir: string) {
    let entries: import("fs").Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.startsWith(".")) continue;

      const stat = await fs.stat(abs);
      const relFromRoot = path.relative(projectsRoot!, abs);
      const relFromClient = path.relative(clientFolderAbs, abs);
      const ext = path.extname(entry.name).replace(/^\./, "").toLowerCase();

      results.push({
        relativePath: relFromRoot,
        absolutePath: abs,
        deliverableType: inferDeliverableType(relFromClient),
        deliverableName: entry.name,
        fileExtension: ext,
        fileSizeBytes: stat.size,
        generatedAt: stat.mtime.toISOString(),
      });
    }
  }

  await walk(clientFolderAbs);
  // Tri stable par chemin
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  // Force la r\u00e9f\u00e9rence \u00e0 projectsRoot pour \u00e9viter le warning unused
  void projectsRoot;
  return results;
}

/**
 * Refuse toute lecture sans racine explicitement configurée.
 */
export function isPathSafe(absolutePath: string): boolean {
  const resolved = path.resolve(absolutePath);
  const root = configuredRoot();
  return root !== null && resolved.startsWith(root + path.sep);
}

/**
 * Convertit une extension en MIME type basique.
 */
export function extensionToMime(ext: string): string {
  const map: Record<string, string> = {
    md: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    json: "application/json; charset=utf-8",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    mp4: "video/mp4",
    webm: "video/webm",
  };
  return map[ext.toLowerCase()] || "application/octet-stream";
}
