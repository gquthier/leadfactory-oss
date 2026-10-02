import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// CSV parsing helpers
// ---------------------------------------------------------------------------

/** Strip UTF-8 BOM if present */
function stripBOM(str: string): string {
  return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
}

/** Detect delimiter: semicolon takes priority when the first line contains one */
function detectDelimiter(firstLine: string): string {
  return firstLine.includes(";") ? ";" : ",";
}

/**
 * Parse a CSV string into an array of objects keyed by header.
 * Handles quoted fields (including those containing the delimiter or newlines).
 */
function parseCSV(raw: string): Record<string, string>[] {
  const text = stripBOM(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);

  function splitLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          // Escaped quote?
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === delimiter) {
          fields.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Column mapping: normalised header → lead field
// ---------------------------------------------------------------------------

const COLUMN_MAP: Record<string, string> = {
  // full_name
  nom: "full_name",
  name: "full_name",
  "full name": "full_name",
  "full_name": "full_name",
  prénom: "first_name", // combined later if needed
  prenom: "first_name",
  "first name": "first_name",
  first_name: "first_name",
  // email
  email: "email",
  "e-mail": "email",
  courriel: "email",
  // phone
  téléphone: "phone",
  telephone: "phone",
  phone: "phone",
  "phone number": "phone",
  "numéro de téléphone": "phone",
  mobile: "phone",
  // company
  entreprise: "company",
  company: "company",
  société: "company",
  societe: "company",
  "nom de l'entreprise": "company",
  // source
  source: "source",
  provenance: "source",
  // notes
  notes: "notes",
  note: "notes",
  commentaires: "notes",
  commentaire: "notes",
  // city
  ville: "city",
  city: "city",
};

function mapRow(
  row: Record<string, string>
): { mapped: Record<string, string>; unmapped: string[] } {
  const mapped: Record<string, string> = {};
  const unmapped: string[] = [];

  for (const [header, value] of Object.entries(row)) {
    const field = COLUMN_MAP[header.toLowerCase().trim()];
    if (field && value) {
      mapped[field] = value;
    } else if (!field && value) {
      unmapped.push(header);
    }
  }

  // Combine first_name into full_name if full_name is missing
  if (!mapped.full_name && mapped.first_name) {
    mapped.full_name = mapped.first_name;
    delete mapped.first_name;
  }

  return { mapped, unmapped };
}

// ---------------------------------------------------------------------------
// Valid source values from the DB CHECK constraint
// ---------------------------------------------------------------------------
const VALID_SOURCES = new Set([
  "meta_ads",
  "google_ads",
  "manual",
  "website",
  "referral",
  "phone",
  "email",
  "linkedin",
  "salon",
  "other",
]);

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const clientId = session.user.id;

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Le corps de la requête doit être de type multipart/form-data" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "Aucun fichier CSV fourni. Utilisez le champ 'file'." },
      { status: 400 }
    );
  }

  const csvText = await (file as File).text();
  if (!csvText.trim()) {
    return NextResponse.json({ error: "Le fichier CSV est vide" }, { status: 400 });
  }

  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Aucune donnée trouvée dans le fichier CSV" },
      { status: 400 }
    );
  }

  // Pre-fetch existing emails and phones for duplicate detection
  const { data: existingLeads } = await adminSupabase
    .from("leads")
    .select("email, phone")
    .eq("client_id", clientId);

  const existingEmails = new Set(
    (existingLeads ?? []).map((l) => l.email?.toLowerCase()).filter(Boolean)
  );
  const existingPhones = new Set(
    (existingLeads ?? [])
      .map((l) => l.phone?.replace(/\s+/g, ""))
      .filter(Boolean)
  );

  let imported = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // +2 because row 1 is headers, arrays are 0-indexed
    const { mapped } = mapRow(rows[i]);

    if (!mapped.full_name || mapped.full_name.trim() === "") {
      errors.push(`Ligne ${rowNum} : nom manquant, ligne ignorée`);
      continue;
    }

    // Duplicate detection
    const emailNorm = mapped.email?.toLowerCase();
    const phoneNorm = mapped.phone?.replace(/\s+/g, "");

    if (
      (emailNorm && existingEmails.has(emailNorm)) ||
      (phoneNorm && existingPhones.has(phoneNorm))
    ) {
      duplicates++;
      continue;
    }

    // Validate / normalise source
    const source = mapped.source
      ? VALID_SOURCES.has(mapped.source.toLowerCase())
        ? mapped.source.toLowerCase()
        : "other"
      : "manual";

    const { data: lead, error: insertError } = await adminSupabase
      .from("leads")
      .insert({
        client_id: clientId,
        full_name: mapped.full_name.trim(),
        email: mapped.email || null,
        phone: mapped.phone || null,
        company: mapped.company || null,
        source,
        notes: mapped.notes || null,
        city: mapped.city || null,
        tags: [],
      })
      .select("id")
      .single();

    if (insertError) {
      errors.push(`Ligne ${rowNum} (${mapped.full_name}) : ${insertError.message}`);
      continue;
    }

    // Create initial activity
    await adminSupabase.from("lead_activities").insert({
      lead_id: lead.id,
      client_id: clientId,
      activity_type: "note",
      title: "Lead importé via CSV",
      created_by: clientId,
    });

    // Update in-memory sets to avoid duplicates within the same import batch
    if (emailNorm) existingEmails.add(emailNorm);
    if (phoneNorm) existingPhones.add(phoneNorm);

    imported++;
  }

  return NextResponse.json({ imported, duplicates, errors });
}
