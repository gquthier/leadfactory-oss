"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import {
  FileText,
  Save,
  Download,
  Check,
  Loader2,
  Plus,
  Trash2,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronUp,
  Copy,
  ClipboardCheck,
  Sparkles,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CampaignProposalEditorProps {
  campaignId: string;
  initialMarkdown: string | null;
  clientName: string;
  onboardingData?: Record<string, unknown> | null;
}

type SaveStatus = "saved" | "saving" | "unsaved" | "idle";

interface Creative {
  name: string;
  angle: string;
  format: string;
  headline: string;
  primaryText: string;
}

interface AdSet {
  name: string;
  geo: string;
  age: string;
  sex: string;
  interests: string;
}

interface CampaignSection {
  id: string;
  name: string;
  objective: string;
  dailyBudget: string;
  testDuration: string;
  adSets: AdSet[];
  creatives: Creative[];
}

interface ProposalData {
  briefHtml: string;
  qualificationHtml: string;
  campaigns: CampaignSection[];
}

// ─── Angles créatifs ─────────────────────────────────────────────────────────

const CREATIVE_ANGLES = ["Douleur", "Désir", "Preuve", "Contre-intuitif", "Urgence"];

// ─── Default data ────────────────────────────────────────────────────────────

function createDefaultCampaign(index: number): CampaignSection {
  return {
    id: crypto.randomUUID(),
    name: `Campagne ${index + 1}`,
    objective: "Leads",
    dailyBudget: "",
    testDuration: "14 jours",
    adSets: [
      { name: "Audience par intérêts", geo: "France", age: "25-55", sex: "Tous", interests: "" },
      { name: "Audience Broad", geo: "France", age: "25-55", sex: "Tous", interests: "aucun" },
    ],
    creatives: CREATIVE_ANGLES.map((angle, i) => ({
      name: `Créative ${i + 1}`,
      angle,
      format: "Image statique 1080x1080",
      headline: "",
      primaryText: "",
    })),
  };
}

function getDefaultData(): ProposalData {
  return {
    briefHtml: "<p>Décrivez ici le contexte, l'offre, le funnel choisi, l'objectif de la phase de test, et ce que vous cherchez à valider.</p>",
    qualificationHtml: "<h3>Question 1 — [Énoncé]</h3><p><strong>Type</strong> : Choix unique</p><ul><li>Option A</li><li>Option B</li><li>Option C</li></ul><h3>Question 2 — [Énoncé]</h3><p><strong>Type</strong> : Choix unique</p><ul><li>Option A</li><li>Option B</li></ul><h3>Règle de qualification</h3><p><strong>Lead qualifié si</strong> :</p><ul><li>Q1 = [...]</li><li>ET Q2 = [...]</li></ul><p><strong>Lead disqualifié si</strong> :</p><ul><li>Q1 = [...]</li></ul>",
    campaigns: [createDefaultCampaign(0)],
  };
}

// ─── Parse saved JSON or legacy markdown ─────────────────────────────────────

function parseInitialData(raw: string | null): ProposalData {
  if (!raw) return getDefaultData();
  try {
    const parsed = JSON.parse(raw);
    if (parsed.briefHtml && parsed.campaigns) return parsed as ProposalData;
  } catch {
    // legacy markdown — put it all in briefHtml
  }
  return {
    ...getDefaultData(),
    briefHtml: raw.replace(/\n/g, "<br>"),
  };
}

// ─── Tiptap Toolbar ──────────────────────────────────────────────────────────

function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  const btn = (active: boolean) =>
    `p-1.5 border-2 border-black transition-all ${active ? "bg-lf-black text-white" : "bg-white hover:bg-gray-100"}`;

  return (
    <div className="flex flex-wrap gap-1 px-3 py-2 border-b-3 border-black bg-gray-50">
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive("bold"))} title="Gras">
        <Bold className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive("italic"))} title="Italique">
        <Italic className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive("underline"))} title="Souligné">
        <UnderlineIcon className="w-3.5 h-3.5" />
      </button>
      <div className="w-px bg-black mx-1" />
      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive("heading", { level: 2 }))} title="Titre 2">
        <Heading1 className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btn(editor.isActive("heading", { level: 3 }))} title="Titre 3">
        <Heading2 className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} className={btn(editor.isActive("heading", { level: 4 }))} title="Titre 4">
        <Heading3 className="w-3.5 h-3.5" />
      </button>
      <div className="w-px bg-black mx-1" />
      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive("bulletList"))} title="Liste à puces">
        <List className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive("orderedList"))} title="Liste numérotée">
        <ListOrdered className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Rich text section editor ────────────────────────────────────────────────

function RichSection({
  title,
  color,
  content,
  onChange,
  placeholder,
  collapsed,
  onToggle,
  onGenerate,
  generating,
}: {
  title: string;
  color: string;
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  collapsed: boolean;
  onToggle: () => void;
  onGenerate?: () => void;
  generating?: boolean;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder: placeholder || "Écrivez ici..." }),
    ],
    content,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none p-4 min-h-[200px] focus:outline-none [&_h2]:text-lg [&_h2]:font-black [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-bold [&_h3]:mt-3 [&_h3]:mb-1 [&_h4]:text-sm [&_h4]:font-bold [&_h4]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_li]:my-0.5",
      },
    },
  });

  // Update editor content when AI generates new content
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
    // Only re-run when content prop changes externally (AI generation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  return (
    <div className="border-3 border-black overflow-hidden">
      <div className={`flex items-center justify-between px-5 py-3 ${color}`}>
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 font-black uppercase text-sm tracking-wider"
        >
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          {title}
        </button>
        {onGenerate && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onGenerate(); }}
            disabled={generating}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase border-2 border-black bg-white text-black hover:shadow-brutal-xs transition-all disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {generating ? "Génération..." : "Générer IA"}
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="bg-white">
          <EditorToolbar editor={editor} />
          <EditorContent editor={editor} />
        </div>
      )}
    </div>
  );
}

// ─── Campaign Card ───────────────────────────────────────────────────────────

function CampaignCard({
  campaign,
  index,
  onChange,
  onRemove,
  canRemove,
  onGenerate,
  generating,
}: {
  campaign: CampaignSection;
  index: number;
  onChange: (updated: CampaignSection) => void;
  onRemove: () => void;
  canRemove: boolean;
  onGenerate?: () => void;
  generating?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const updateField = <K extends keyof CampaignSection>(key: K, value: CampaignSection[K]) => {
    onChange({ ...campaign, [key]: value });
  };

  const updateAdSet = (adSetIndex: number, field: keyof AdSet, value: string) => {
    const newAdSets = [...campaign.adSets];
    newAdSets[adSetIndex] = { ...newAdSets[adSetIndex], [field]: value };
    updateField("adSets", newAdSets);
  };

  const updateCreative = (creativeIndex: number, field: keyof Creative, value: string) => {
    const newCreatives = [...campaign.creatives];
    newCreatives[creativeIndex] = { ...newCreatives[creativeIndex], [field]: value };
    updateField("creatives", newCreatives);
  };

  const addCreative = () => {
    const n = campaign.creatives.length;
    updateField("creatives", [
      ...campaign.creatives,
      {
        name: `Créative ${n + 1}`,
        angle: CREATIVE_ANGLES[n % CREATIVE_ANGLES.length],
        format: "Image statique 1080x1080",
        headline: "",
        primaryText: "",
      },
    ]);
  };

  const removeCreative = (i: number) => {
    updateField("creatives", campaign.creatives.filter((_, idx) => idx !== i));
  };

  const inputCls = "w-full px-3 py-2 text-sm border-3 border-black bg-white focus:outline-none focus:border-lf-blue transition-colors";
  const labelCls = "text-[11px] font-black uppercase tracking-wider text-lf-gray mb-1 block";

  return (
    <div className="border-3 border-black overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-lf-pink border-b-3 border-black">
        <button type="button" onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 font-black uppercase text-sm tracking-wider">
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          Campagne {index + 1} — {campaign.name || "Sans nom"}
        </button>
        <div className="flex items-center gap-2">
          {onGenerate && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onGenerate(); }}
              disabled={generating}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase border-2 border-black bg-white text-black hover:shadow-brutal-xs transition-all disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {generating ? "Génération..." : "Générer IA"}
            </button>
          )}
          {canRemove && (
            <button type="button" onClick={onRemove} className="p-1.5 hover:bg-red-100 border-2 border-black bg-white" title="Supprimer">
              <Trash2 className="w-3.5 h-3.5 text-red-600" />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="bg-white p-5 space-y-5">
          {/* Campaign meta */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Nom de campagne</label>
              <input className={inputCls} value={campaign.name} onChange={(e) => updateField("name", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Objectif Meta</label>
              <select className={inputCls} value={campaign.objective} onChange={(e) => updateField("objective", e.target.value)}>
                <option>Leads</option>
                <option>Conversions</option>
                <option>Sales</option>
                <option>Traffic</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Budget quotidien</label>
              <input className={inputCls} placeholder="Ex : 50 €/jour" value={campaign.dailyBudget} onChange={(e) => updateField("dailyBudget", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Durée du test</label>
              <input className={inputCls} placeholder="Ex : 14 jours" value={campaign.testDuration} onChange={(e) => updateField("testDuration", e.target.value)} />
            </div>
          </div>

          {/* Ad Sets */}
          <div>
            <h4 className="font-black uppercase text-xs tracking-wider mb-3 flex items-center gap-2">
              <span className="inline-block w-2 h-2 bg-lf-blue" /> Ad Sets
            </h4>
            <div className="space-y-3">
              {campaign.adSets.map((adSet, ai) => (
                <div key={ai} className="border-2 border-black p-3 bg-gray-50">
                  <p className="text-xs font-bold mb-2">{adSet.name}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div>
                      <label className={labelCls}>Géo</label>
                      <input className={inputCls + " !text-xs"} value={adSet.geo} onChange={(e) => updateAdSet(ai, "geo", e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Âge</label>
                      <input className={inputCls + " !text-xs"} value={adSet.age} onChange={(e) => updateAdSet(ai, "age", e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Sexe</label>
                      <input className={inputCls + " !text-xs"} value={adSet.sex} onChange={(e) => updateAdSet(ai, "sex", e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <label className={labelCls}>Intérêts</label>
                      <input className={inputCls + " !text-xs"} value={adSet.interests} onChange={(e) => updateAdSet(ai, "interests", e.target.value)} placeholder="Liste d'intérêts ou 'aucun'" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Creatives */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-black uppercase text-xs tracking-wider flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-lf-yellow" /> Créatives ({campaign.creatives.length})
              </h4>
              <button type="button" onClick={addCreative} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase border-2 border-black bg-lf-green hover:shadow-brutal-xs transition-all">
                <Plus className="w-3 h-3" /> Ajouter
              </button>
            </div>
            <div className="space-y-3">
              {campaign.creatives.map((creative, ci) => (
                <div key={ci} className="border-2 border-black p-3 bg-white relative">
                  {campaign.creatives.length > 1 && (
                    <button type="button" onClick={() => removeCreative(ci)} className="absolute top-2 right-2 p-1 hover:bg-red-50" title="Supprimer">
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </button>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className={labelCls}>Nom</label>
                      <input className={inputCls + " !text-xs"} value={creative.name} onChange={(e) => updateCreative(ci, "name", e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Angle</label>
                      <select className={inputCls + " !text-xs"} value={creative.angle} onChange={(e) => updateCreative(ci, "angle", e.target.value)}>
                        {CREATIVE_ANGLES.map((a) => <option key={a}>{a}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Format</label>
                      <select className={inputCls + " !text-xs"} value={creative.format} onChange={(e) => updateCreative(ci, "format", e.target.value)}>
                        <option>Image statique 1080x1080</option>
                        <option>Image statique 1080x1350</option>
                        <option>Vidéo 1080x1080</option>
                        <option>Vidéo 9:16 (Reels)</option>
                        <option>Carrousel</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>Headline</label>
                      <input className={inputCls + " !text-xs"} placeholder="Phrase courte qui arrête le scroll" value={creative.headline} onChange={(e) => updateCreative(ci, "headline", e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Primary text</label>
                      <input className={inputCls + " !text-xs"} placeholder="Texte d'accompagnement" value={creative.primaryText} onChange={(e) => updateCreative(ci, "primaryText", e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HTML → Simple text (strip tags) ─────────────────────────────────────────

function htmlToMarkdown(html: string): string {
  let md = html;
  // Headings
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "\n#### $1\n");
  // Bold / Italic
  md = md.replace(/<strong>(.*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<em>(.*?)<\/em>/gi, "*$1*");
  md = md.replace(/<u>(.*?)<\/u>/gi, "$1");
  // Lists
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1");
  md = md.replace(/<\/?[uo]l[^>]*>/gi, "");
  // Paragraphs & breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n");
  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, "");
  // Clean up whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim();
}

// ─── Build full Markdown export ──────────────────────────────────────────────

function buildMarkdown(data: ProposalData, clientName: string): string {
  const lines: string[] = [];

  lines.push(`# Proposition de campagne — ${clientName}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Brief stratégique & Objectif de test");
  lines.push("");
  lines.push(htmlToMarkdown(data.briefHtml));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Formulaire de qualification (Instant Form)");
  lines.push("");
  lines.push(htmlToMarkdown(data.qualificationHtml));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. Structure des campagnes Meta");

  for (let i = 0; i < data.campaigns.length; i++) {
    const c = data.campaigns[i];
    lines.push("");
    lines.push(`### Campagne ${i + 1} — ${c.name}`);
    lines.push("");
    lines.push(`**Objectif Meta** : ${c.objective}`);
    lines.push(`**Budget quotidien** : ${c.dailyBudget || "—"}`);
    lines.push(`**Durée test** : ${c.testDuration}`);

    for (const as of c.adSets) {
      lines.push("");
      lines.push(`#### ${as.name}`);
      lines.push(`- Géo : ${as.geo}`);
      lines.push(`- Âge : ${as.age}`);
      lines.push(`- Sexe : ${as.sex}`);
      lines.push(`- Intérêts : ${as.interests || "aucun"}`);
    }

    lines.push("");
    lines.push(`#### Créatives (${c.creatives.length})`);

    for (const cr of c.creatives) {
      lines.push("");
      lines.push(`##### ${cr.name} (Angle : ${cr.angle})`);
      lines.push(`**Format** : ${cr.format}`);
      lines.push(`**Headline** : ${cr.headline || "—"}`);
      lines.push(`**Primary text** : ${cr.primaryText || "—"}`);
    }
  }

  return lines.join("\n");
}

// ─── PDF Generation ──────────────────────────────────────────────────────────

async function generatePdf(data: ProposalData, clientName: string) {
  const html2pdfModule = await import("html2pdf.js");
  const html2pdf = html2pdfModule.default;

  const html = buildPdfHtml(data, clientName);

  // Create a visible container (off-screen but rendered) for html2canvas
  const container = document.createElement("div");
  container.innerHTML = html;
  container.style.position = "fixed";
  container.style.left = "0";
  container.style.top = "0";
  container.style.width = "794px"; // A4 width in px at 96dpi
  container.style.background = "#ffffff";
  container.style.zIndex = "-1";
  container.style.opacity = "0";
  container.style.pointerEvents = "none";
  document.body.appendChild(container);

  // Wait for rendering
  await new Promise((r) => setTimeout(r, 300));

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (html2pdf() as any)
      .set({
        margin: [12, 12, 12, 12],
        filename: `Proposition-${clientName.replace(/\s+/g, "-")}.pdf`,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
          windowWidth: 794,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"], avoid: ["tr", "td"] },
      })
      .from(container)
      .save();
  } finally {
    document.body.removeChild(container);
  }
}

function buildPdfHtml(data: ProposalData, clientName: string): string {
  const campaignsHtml = data.campaigns
    .map(
      (c, i) => `
      <div style="page-break-inside: avoid; margin-top: 24px;">
        <h2 style="font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:1px;border-bottom:3px solid #000;padding-bottom:8px;margin-bottom:16px;">
          Campagne ${i + 1} — ${c.name}
        </h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <tr>
            <td style="border:2px solid #000;padding:8px;font-weight:700;font-size:11px;text-transform:uppercase;background:#f5f5f5;">Objectif Meta</td>
            <td style="border:2px solid #000;padding:8px;font-size:12px;">${c.objective}</td>
            <td style="border:2px solid #000;padding:8px;font-weight:700;font-size:11px;text-transform:uppercase;background:#f5f5f5;">Budget/jour</td>
            <td style="border:2px solid #000;padding:8px;font-size:12px;">${c.dailyBudget || "—"}</td>
            <td style="border:2px solid #000;padding:8px;font-weight:700;font-size:11px;text-transform:uppercase;background:#f5f5f5;">Durée test</td>
            <td style="border:2px solid #000;padding:8px;font-size:12px;">${c.testDuration}</td>
          </tr>
        </table>
        ${c.adSets
          .map(
            (as) => `
          <div style="border:2px solid #000;padding:12px;margin-bottom:8px;background:#fafafa;">
            <p style="font-weight:800;font-size:11px;text-transform:uppercase;margin:0 0 8px 0;">${as.name}</p>
            <p style="font-size:11px;margin:2px 0;">Géo : ${as.geo} · Âge : ${as.age} · Sexe : ${as.sex}</p>
            <p style="font-size:11px;margin:2px 0;">Intérêts : ${as.interests || "—"}</p>
          </div>`
          )
          .join("")}
        <h3 style="font-size:13px;font-weight:800;text-transform:uppercase;margin:16px 0 8px 0;">Créatives (${c.creatives.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="background:#000;color:#fff;">
              <th style="border:2px solid #000;padding:6px;text-align:left;">Nom</th>
              <th style="border:2px solid #000;padding:6px;text-align:left;">Angle</th>
              <th style="border:2px solid #000;padding:6px;text-align:left;">Format</th>
              <th style="border:2px solid #000;padding:6px;text-align:left;">Headline</th>
              <th style="border:2px solid #000;padding:6px;text-align:left;">Primary text</th>
            </tr>
          </thead>
          <tbody>
            ${c.creatives
              .map(
                (cr, ci) => `
              <tr style="background:${ci % 2 === 0 ? "#fff" : "#f9f9f9"};">
                <td style="border:2px solid #000;padding:6px;font-weight:700;">${cr.name}</td>
                <td style="border:2px solid #000;padding:6px;"><span style="background:#FDE047;padding:2px 6px;font-weight:700;font-size:10px;">${cr.angle}</span></td>
                <td style="border:2px solid #000;padding:6px;">${cr.format}</td>
                <td style="border:2px solid #000;padding:6px;">${cr.headline || "—"}</td>
                <td style="border:2px solid #000;padding:6px;">${cr.primaryText || "—"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    )
    .join("");

  return `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#000;line-height:1.5;">
      <!-- Cover -->
      <div style="text-align:center;padding:60px 20px;border-bottom:3px solid #000;margin-bottom:30px;">
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:3px;color:#666;margin-bottom:8px;">LeadFactory</p>
        <h1 style="font-size:28px;font-weight:900;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px 0;">
          Proposition de campagne
        </h1>
        <p style="font-size:18px;font-weight:700;margin:0 0 24px 0;">${clientName}</p>
        <p style="font-size:11px;color:#888;">${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
      </div>

      <!-- Section 1: Brief -->
      <div style="margin-bottom:24px;">
        <h2 style="font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:1px;border-bottom:3px solid #000;padding-bottom:8px;margin-bottom:16px;">
          1. Brief stratégique & Objectif de test
        </h2>
        <div style="font-size:13px;line-height:1.7;">${data.briefHtml}</div>
      </div>

      <!-- Section 2: Qualification -->
      <div style="margin-bottom:24px;">
        <h2 style="font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:1px;border-bottom:3px solid #000;padding-bottom:8px;margin-bottom:16px;">
          2. Formulaire de qualification
        </h2>
        <div style="font-size:13px;line-height:1.7;">${data.qualificationHtml}</div>
      </div>

      <!-- Section 3: Campaigns -->
      <div>
        <h2 style="font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:1px;border-bottom:3px solid #000;padding-bottom:8px;margin-bottom:8px;">
          3. Structure des campagnes Meta
        </h2>
        ${campaignsHtml}
      </div>

      <!-- Footer -->
      <div style="margin-top:40px;padding-top:16px;border-top:3px solid #000;text-align:center;">
        <p style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:2px;">
          Document généré par LeadFactory · ${new Date().toLocaleDateString("fr-FR")}
        </p>
      </div>
    </div>`;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CampaignProposalEditor({
  campaignId,
  initialMarkdown,
  clientName,
  onboardingData = null,
}: CampaignProposalEditorProps) {
  const [data, setData] = useState<ProposalData>(() => parseInitialData(initialMarkdown));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [fullscreen, setFullscreen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  // ── Serialize data to JSON for storage ──────────────────────────────────
  const serialize = useCallback(() => JSON.stringify(data), [data]);

  // ── Auto-save ───────────────────────────────────────────────────────────
  const saveProposal = useCallback(
    async (content: string) => {
      setSaveStatus("saving");
      try {
        const res = await fetch("/api/admin/campaign-proposal", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaign_id: campaignId, proposal_markdown: content }),
        });
        if (!res.ok) throw new Error("Save failed");
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [campaignId]
  );

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setSaveStatus("unsaved");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveProposal(serialize());
    }, 2000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [data, serialize, saveProposal]);

  // ── Toast ───────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => () => { if (toastRef.current) clearTimeout(toastRef.current); }, []);

  // ── Data updaters ───────────────────────────────────────────────────────
  const updateBrief = useCallback((html: string) => setData((d) => ({ ...d, briefHtml: html })), []);
  const updateQualification = useCallback((html: string) => setData((d) => ({ ...d, qualificationHtml: html })), []);

  const updateCampaign = useCallback((id: string, updated: CampaignSection) => {
    setData((d) => ({
      ...d,
      campaigns: d.campaigns.map((c) => (c.id === id ? updated : c)),
    }));
  }, []);

  const removeCampaign = useCallback((id: string) => {
    setData((d) => ({ ...d, campaigns: d.campaigns.filter((c) => c.id !== id) }));
  }, []);

  const addCampaign = useCallback(() => {
    setData((d) => ({
      ...d,
      campaigns: [...d.campaigns, createDefaultCampaign(d.campaigns.length)],
    }));
  }, []);

  // ── AI Generation ──────────────────────────────────────────────────────
  const generateSection = useCallback(async (section: "brief" | "qualification" | "campaign", campaignIndex?: number) => {
    const sectionKey = section === "campaign" ? `campaign-${campaignIndex}` : section;
    setGeneratingSection(sectionKey);
    try {
      const res = await fetch("/api/admin/generate-proposal-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section,
          campaign_id: campaignId,
          clientName,
          onboardingData,
          aiDeliverables: null,
          existingProposal: {
            briefHtml: data.briefHtml,
            qualificationHtml: data.qualificationHtml,
            campaigns: data.campaigns.map((c) => ({
              name: c.name,
              objective: c.objective,
              dailyBudget: c.dailyBudget,
              testDuration: c.testDuration,
              adSets: c.adSets,
              creatives: c.creatives,
            })),
          },
          campaignIndex,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erreur serveur" }));
        throw new Error(err.error || "Erreur de génération");
      }

      const result = await res.json();

      if (section === "brief" && result.briefHtml) {
        setData((d) => ({ ...d, briefHtml: result.briefHtml }));
        showToast("Brief généré avec succès !");
      } else if (section === "qualification" && result.qualificationHtml) {
        setData((d) => ({ ...d, qualificationHtml: result.qualificationHtml }));
        showToast("Formulaire généré avec succès !");
      } else if (section === "campaign" && result.campaign && campaignIndex != null) {
        setData((d) => {
          const newCampaigns = [...d.campaigns];
          if (newCampaigns[campaignIndex]) {
            newCampaigns[campaignIndex] = {
              ...newCampaigns[campaignIndex],
              ...result.campaign,
              id: newCampaigns[campaignIndex].id, // preserve ID
            };
          }
          return { ...d, campaigns: newCampaigns };
        });
        showToast("Campagne générée avec succès !");
      } else {
        throw new Error("Format de réponse inattendu");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      showToast(`Erreur : ${msg}`);
      console.error("[AI Generation]", err);
    } finally {
      setGeneratingSection(null);
    }
  }, [campaignId, clientName, onboardingData, data, showToast]);

  // ── Toggle section collapse ─────────────────────────────────────────────
  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── PDF generation ──────────────────────────────────────────────────────
  const handleGeneratePdf = useCallback(async () => {
    setGenerating(true);
    try {
      await generatePdf(data, clientName);
      showToast("PDF généré avec succès !");
    } catch (err) {
      console.error("PDF generation error:", err);
      showToast("Erreur lors de la génération du PDF");
    } finally {
      setGenerating(false);
    }
  }, [data, clientName, showToast]);

  // ── Copy as Markdown ───────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const handleCopyMarkdown = useCallback(async () => {
    const md = buildMarkdown(data, clientName);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      showToast("Markdown copié !");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Erreur lors de la copie");
    }
  }, [data, clientName, showToast]);

  // ── Save status config ─────────────────────────────────────────────────
  const statusBadge = () => {
    switch (saveStatus) {
      case "saved":
        return { label: "Sauvegardé", icon: <Check className="w-3.5 h-3.5" />, cls: "text-green-700 bg-green-50 border-green-600" };
      case "saving":
        return { label: "Sauvegarde...", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, cls: "text-blue-700 bg-blue-50 border-blue-600" };
      case "unsaved":
        return { label: "Non sauvegardé", icon: <Save className="w-3.5 h-3.5" />, cls: "text-orange-700 bg-orange-50 border-orange-600" };
      default:
        return { label: "", icon: null, cls: "hidden" };
    }
  };

  const status = statusBadge();

  const wrapperCls = fullscreen
    ? "fixed inset-0 z-50 bg-canvas overflow-y-auto"
    : "";

  return (
    <div className={wrapperCls}>
      <div className={fullscreen ? "max-w-5xl mx-auto p-6" : ""}>
        <div className="border-3 border-black bg-white">
          {/* ── Header ──────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4 border-b-3 border-black bg-gray-50">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5" />
              <h2 className="font-black uppercase text-sm tracking-wider">
                Proposition de campagne
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold border-2 ${status.cls}`}>
                {status.icon} {status.label}
              </span>
              <button
                type="button"
                onClick={() => setFullscreen(!fullscreen)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wider border-3 border-black bg-white hover:bg-gray-100 transition-all"
                title={fullscreen ? "Quitter le plein écran" : "Plein écran"}
              >
                {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                {fullscreen ? "Réduire" : "Plein écran"}
              </button>
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wider border-3 border-black bg-white hover:bg-gray-100 hover:shadow-brutal-xs transition-all"
                title="Copier tout le contenu en Markdown"
              >
                {copied ? <ClipboardCheck className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copié !" : "Copier MD"}
              </button>
              <button
                type="button"
                onClick={handleGeneratePdf}
                disabled={generating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wider border-3 border-black bg-lf-yellow hover:shadow-brutal transition-all disabled:opacity-50"
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {generating ? "Génération..." : "Générer PDF"}
              </button>
            </div>
          </div>

          {/* ── Sections ────────────────────────────────────────────── */}
          <div className="p-6 space-y-6">
            {/* Section 1: Brief */}
            <RichSection
              title="1. Brief stratégique & Objectif de test"
              color="bg-lf-black text-white"
              content={data.briefHtml}
              onChange={updateBrief}
              placeholder="Décrivez le contexte, l'offre, le funnel choisi, l'objectif de test..."
              collapsed={collapsedSections["brief"] ?? false}
              onToggle={() => toggleSection("brief")}
              onGenerate={() => generateSection("brief")}
              generating={generatingSection === "brief"}
            />

            {/* Section 2: Qualification */}
            <RichSection
              title="2. Formulaire de qualification (Instant Form)"
              color="bg-lf-blue text-white"
              content={data.qualificationHtml}
              onChange={updateQualification}
              placeholder="Questions du formulaire, règles de qualification..."
              collapsed={collapsedSections["qualification"] ?? false}
              onToggle={() => toggleSection("qualification")}
              onGenerate={() => generateSection("qualification")}
              generating={generatingSection === "qualification"}
            />

            {/* Section 3: Campaigns */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black uppercase text-sm tracking-wider flex items-center gap-2">
                  <span className="inline-block w-3 h-3 bg-lf-pink border-2 border-black" />
                  3. Structure des campagnes Meta
                </h3>
                <button
                  type="button"
                  onClick={addCampaign}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wider border-3 border-black bg-lf-green hover:shadow-brutal transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter une campagne
                </button>
              </div>
              <div className="space-y-4">
                {data.campaigns.map((campaign, i) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    index={i}
                    onChange={(updated) => updateCampaign(campaign.id, updated)}
                    onRemove={() => removeCampaign(campaign.id)}
                    canRemove={data.campaigns.length > 1}
                    onGenerate={() => generateSection("campaign", i)}
                    generating={generatingSection === `campaign-${i}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Toast ──────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-3 border-3 border-black bg-lf-green text-black text-sm font-bold shadow-brutal">
          <Check className="w-4 h-4" />
          {toast}
        </div>
      )}
    </div>
  );
}
