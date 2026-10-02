"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Palette,
  Save,
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
  FileText,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CampaignCreativeBriefEditorProps {
  campaignId: string;
  clientId: string;
  initialData: string | null;
  clientName: string;
  onboardingData?: Record<string, unknown> | null;
}

type SaveStatus = "saved" | "saving" | "unsaved" | "idle";

interface CreativeTemplate {
  id: string;
  name: string;
  format: string;
  angle: string;
  headline: string;
  subHeadline: string;
  bulletPoints: string[];
  styleDirection: string;
}

interface CreativeBriefData {
  brandIdentityHtml: string;
  targetAudienceHtml: string;
  competitiveLandscapeHtml: string;
  templates: CreativeTemplate[];
  copywritingDirectionHtml: string;
  visualStyleHtml: string;
  referencesHtml: string;
}

// ─── Creative angles & formats ──────────────────────────────────────────────

const CREATIVE_ANGLES = ["Douleur", "Désir", "Preuve sociale", "Contre-intuitif", "Urgence", "Autorité", "Comparaison", "Témoignage", "Éducatif", "Transformation"];
const CREATIVE_FORMATS = ["Image statique 1080x1080", "Image statique 1080x1350", "Carrousel"];

// ─── Default data ────────────────────────────────────────────────────────────

function createDefaultTemplate(index: number): CreativeTemplate {
  return {
    id: crypto.randomUUID(),
    name: `Template ${index + 1}`,
    format: "Image statique 1080x1080",
    angle: CREATIVE_ANGLES[index % CREATIVE_ANGLES.length],
    headline: "",
    subHeadline: "",
    bulletPoints: ["", "", ""],
    styleDirection: "",
  };
}

function getDefaultData(): CreativeBriefData {
  return {
    brandIdentityHtml: "<p>Décrivez ici l'identité de marque : logo, site web, couleurs, polices, guidelines...</p>",
    targetAudienceHtml: "<p>Décrivez ici l'audience cible : persona, douleurs, désirs, objections...</p>",
    competitiveLandscapeHtml: "<p>Analysez ici le paysage concurrentiel : positionnement, styles visuels, angles publicitaires...</p>",
    templates: Array.from({ length: 10 }, (_, i) => createDefaultTemplate(i)),
    copywritingDirectionHtml: "<p>Définissez ici la direction copywriting : ton, messages clés, formulations recommandées...</p>",
    visualStyleHtml: "<p>Recommandations style visuel : palette de couleurs, typographie, imagerie, mood...</p>",
    referencesHtml: "<p>Listez ici les liens et documents de référence : site web, drive, brand guidelines, exemples...</p>",
  };
}

// ─── Parse saved JSON ────────────────────────────────────────────────────────

function parseInitialData(raw: string | null): CreativeBriefData {
  if (!raw) return getDefaultData();
  try {
    const parsed = JSON.parse(raw);
    if (parsed.brandIdentityHtml && parsed.templates) return parsed as CreativeBriefData;
  } catch {
    // invalid JSON
  }
  return getDefaultData();
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

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
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

// ─── Creative Template Card ──────────────────────────────────────────────────

function CreativeTemplateCard({
  template,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  template: CreativeTemplate;
  index: number;
  onChange: (updated: CreativeTemplate) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const updateField = <K extends keyof CreativeTemplate>(key: K, value: CreativeTemplate[K]) => {
    onChange({ ...template, [key]: value });
  };

  const updateBullet = (bulletIndex: number, value: string) => {
    const newBullets = [...template.bulletPoints];
    newBullets[bulletIndex] = value;
    updateField("bulletPoints", newBullets);
  };

  const addBullet = () => {
    updateField("bulletPoints", [...template.bulletPoints, ""]);
  };

  const removeBullet = (bulletIndex: number) => {
    updateField("bulletPoints", template.bulletPoints.filter((_, i) => i !== bulletIndex));
  };

  const inputCls = "w-full px-3 py-2 text-sm border-3 border-black bg-white focus:outline-none focus:border-lf-blue transition-colors";
  const labelCls = "text-[11px] font-black uppercase tracking-wider text-lf-gray mb-1 block";

  return (
    <div className="border-3 border-black overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-lf-pink border-b-3 border-black">
        <button type="button" onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 font-black uppercase text-sm tracking-wider">
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          Template {index + 1} — {template.name || "Sans nom"}
        </button>
        {canRemove && (
          <button type="button" onClick={onRemove} className="p-1.5 hover:bg-red-100 border-2 border-black bg-white" title="Supprimer">
            <Trash2 className="w-3.5 h-3.5 text-red-600" />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="bg-white p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Nom</label>
              <input className={inputCls} value={template.name} onChange={(e) => updateField("name", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Format</label>
              <select className={inputCls} value={template.format} onChange={(e) => updateField("format", e.target.value)}>
                {CREATIVE_FORMATS.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Angle</label>
              <select className={inputCls} value={template.angle} onChange={(e) => updateField("angle", e.target.value)}>
                {CREATIVE_ANGLES.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Headline</label>
              <input className={inputCls} placeholder="Phrase courte qui arrête le scroll" value={template.headline} onChange={(e) => updateField("headline", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Sub-headline</label>
              <input className={inputCls} placeholder="Phrase de support" value={template.subHeadline} onChange={(e) => updateField("subHeadline", e.target.value)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls}>Bullet points</label>
              <button type="button" onClick={addBullet} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase border-2 border-black bg-lf-green hover:shadow-brutal-xs transition-all">
                <Plus className="w-3 h-3" /> Ajouter
              </button>
            </div>
            <div className="space-y-2">
              {template.bulletPoints.map((bullet, bi) => (
                <div key={bi} className="flex gap-2">
                  <input
                    className={inputCls + " flex-1"}
                    placeholder={`Point ${bi + 1}`}
                    value={bullet}
                    onChange={(e) => updateBullet(bi, e.target.value)}
                  />
                  {template.bulletPoints.length > 1 && (
                    <button type="button" onClick={() => removeBullet(bi)} className="p-2 hover:bg-red-50 border-2 border-black" title="Supprimer">
                      <Trash2 className="w-3 h-3 text-red-500" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Direction style</label>
            <input className={inputCls} placeholder="Description du style visuel recommandé" value={template.styleDirection} onChange={(e) => updateField("styleDirection", e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HTML → Markdown ─────────────────────────────────────────────────────────

function htmlToMarkdown(html: string): string {
  let md = html;
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<strong>(.*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<em>(.*?)<\/em>/gi, "*$1*");
  md = md.replace(/<u>(.*?)<\/u>/gi, "$1");
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1");
  md = md.replace(/<\/?[uo]l[^>]*>/gi, "");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n");
  md = md.replace(/<[^>]+>/g, "");
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim();
}

function buildMarkdown(data: CreativeBriefData, clientName: string): string {
  const lines: string[] = [];

  lines.push(`# Brief Créatif — ${clientName}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Identité de marque");
  lines.push("");
  lines.push(htmlToMarkdown(data.brandIdentityHtml));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Audience cible");
  lines.push("");
  lines.push(htmlToMarkdown(data.targetAudienceHtml));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. Paysage concurrentiel");
  lines.push("");
  lines.push(htmlToMarkdown(data.competitiveLandscapeHtml));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 4. Templates créatifs");

  for (const t of data.templates) {
    lines.push("");
    lines.push(`### ${t.name} (${t.angle})`);
    lines.push(`**Format** : ${t.format}`);
    lines.push(`**Headline** : ${t.headline || "—"}`);
    lines.push(`**Sub-headline** : ${t.subHeadline || "—"}`);
    if (t.bulletPoints.length > 0) {
      lines.push("**Bullet points** :");
      for (const bp of t.bulletPoints) {
        if (bp) lines.push(`- ${bp}`);
      }
    }
    lines.push(`**Style** : ${t.styleDirection || "—"}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 5. Direction copywriting");
  lines.push("");
  lines.push(htmlToMarkdown(data.copywritingDirectionHtml));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 6. Style visuel");
  lines.push("");
  lines.push(htmlToMarkdown(data.visualStyleHtml));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 7. Références & Documents");
  lines.push("");
  lines.push(htmlToMarkdown(data.referencesHtml));

  return lines.join("\n");
}

// ─── Main Component ──────────────────────────────────────────────────────────

type SectionType = "brand_identity" | "target_audience" | "competitive_landscape" | "templates" | "copywriting" | "visual_style" | "references";

export function CampaignCreativeBriefEditor({
  campaignId,
  initialData,
  clientName,
  onboardingData = null,
}: CampaignCreativeBriefEditorProps) {
  const [data, setData] = useState<CreativeBriefData>(() => parseInitialData(initialData));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  // ── Serialize data to JSON for storage ──────────────────────────────────
  const serialize = useCallback(() => JSON.stringify(data), [data]);

  // ── Auto-save ───────────────────────────────────────────────────────────
  const saveBrief = useCallback(
    async (content: string) => {
      setSaveStatus("saving");
      try {
        const res = await fetch("/api/admin/creative-brief", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaign_id: campaignId, creative_brief: content }),
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
      saveBrief(serialize());
    }, 2000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [data, serialize, saveBrief]);

  // ── Toast ───────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => () => { if (toastRef.current) clearTimeout(toastRef.current); }, []);

  // ── Data updaters ───────────────────────────────────────────────────────
  const updateSection = useCallback((key: keyof CreativeBriefData, value: string) => {
    setData((d) => ({ ...d, [key]: value }));
  }, []);

  const updateTemplate = useCallback((id: string, updated: CreativeTemplate) => {
    setData((d) => ({
      ...d,
      templates: d.templates.map((t) => (t.id === id ? updated : t)),
    }));
  }, []);

  const removeTemplate = useCallback((id: string) => {
    setData((d) => ({ ...d, templates: d.templates.filter((t) => t.id !== id) }));
  }, []);

  const addTemplate = useCallback(() => {
    setData((d) => ({
      ...d,
      templates: [...d.templates, createDefaultTemplate(d.templates.length)],
    }));
  }, []);

  // ── AI Generation ──────────────────────────────────────────────────────
  const generateSection = useCallback(async (section: SectionType) => {
    setGeneratingSection(section);
    try {
      const res = await fetch("/api/admin/generate-creative-brief-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section,
          campaign_id: campaignId,
          clientName,
          onboardingData,
          existingBrief: data,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erreur serveur" }));
        throw new Error(err.error || "Erreur de génération");
      }

      const result = await res.json();

      switch (section) {
        case "brand_identity":
          if (result.brandIdentityHtml) {
            setData((d) => ({ ...d, brandIdentityHtml: result.brandIdentityHtml }));
            showToast("Identité de marque générée !");
          }
          break;
        case "target_audience":
          if (result.targetAudienceHtml) {
            setData((d) => ({ ...d, targetAudienceHtml: result.targetAudienceHtml }));
            showToast("Audience cible générée !");
          }
          break;
        case "competitive_landscape":
          if (result.competitiveLandscapeHtml) {
            setData((d) => ({ ...d, competitiveLandscapeHtml: result.competitiveLandscapeHtml }));
            showToast("Paysage concurrentiel généré !");
          }
          break;
        case "templates":
          if (result.templates && Array.isArray(result.templates)) {
            setData((d) => ({ ...d, templates: result.templates }));
            showToast("10 templates créatifs générés !");
          }
          break;
        case "copywriting":
          if (result.copywritingDirectionHtml) {
            setData((d) => ({ ...d, copywritingDirectionHtml: result.copywritingDirectionHtml }));
            showToast("Direction copywriting générée !");
          }
          break;
        case "visual_style":
          if (result.visualStyleHtml) {
            setData((d) => ({ ...d, visualStyleHtml: result.visualStyleHtml }));
            showToast("Style visuel généré !");
          }
          break;
        case "references":
          if (result.referencesHtml) {
            setData((d) => ({ ...d, referencesHtml: result.referencesHtml }));
            showToast("Références générées !");
          }
          break;
        default:
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
              <Palette className="w-5 h-5" />
              <h2 className="font-black uppercase text-sm tracking-wider">
                Brief Créatif
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
            </div>
          </div>

          {/* ── Sections ────────────────────────────────────────────── */}
          <div className="p-6 space-y-6">
            {/* Section 1: Brand Identity */}
            <RichSection
              title="1. Identité de marque"
              color="bg-lf-black text-white"
              content={data.brandIdentityHtml}
              onChange={(html) => updateSection("brandIdentityHtml", html)}
              placeholder="Logo, site web, couleurs, polices, guidelines..."
              collapsed={collapsedSections["brand_identity"] ?? false}
              onToggle={() => toggleSection("brand_identity")}
              onGenerate={() => generateSection("brand_identity")}
              generating={generatingSection === "brand_identity"}
            />

            {/* Section 2: Target Audience */}
            <RichSection
              title="2. Audience cible"
              color="bg-lf-blue text-white"
              content={data.targetAudienceHtml}
              onChange={(html) => updateSection("targetAudienceHtml", html)}
              placeholder="Persona, douleurs, désirs, objections..."
              collapsed={collapsedSections["target_audience"] ?? false}
              onToggle={() => toggleSection("target_audience")}
              onGenerate={() => generateSection("target_audience")}
              generating={generatingSection === "target_audience"}
            />

            {/* Section 3: Competitive Landscape */}
            <RichSection
              title="3. Paysage concurrentiel"
              color="bg-lf-yellow text-black"
              content={data.competitiveLandscapeHtml}
              onChange={(html) => updateSection("competitiveLandscapeHtml", html)}
              placeholder="Analyse concurrentielle, positionnement, différenciation..."
              collapsed={collapsedSections["competitive_landscape"] ?? false}
              onToggle={() => toggleSection("competitive_landscape")}
              onGenerate={() => generateSection("competitive_landscape")}
              generating={generatingSection === "competitive_landscape"}
            />

            {/* Section 4: Creative Templates */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black uppercase text-sm tracking-wider flex items-center gap-2">
                  <span className="inline-block w-3 h-3 bg-lf-pink border-2 border-black" />
                  4. Templates créatifs ({data.templates.length})
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => generateSection("templates")}
                    disabled={generatingSection === "templates"}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase border-2 border-black bg-white text-black hover:shadow-brutal-xs transition-all disabled:opacity-50"
                  >
                    {generatingSection === "templates" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {generatingSection === "templates" ? "Génération..." : "Générer IA"}
                  </button>
                  <button
                    type="button"
                    onClick={addTemplate}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wider border-3 border-black bg-lf-green hover:shadow-brutal transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Ajouter
                  </button>
                </div>
              </div>
              <div className="space-y-4">
                {data.templates.map((template, i) => (
                  <CreativeTemplateCard
                    key={template.id}
                    template={template}
                    index={i}
                    onChange={(updated) => updateTemplate(template.id, updated)}
                    onRemove={() => removeTemplate(template.id)}
                    canRemove={data.templates.length > 1}
                  />
                ))}
              </div>
            </div>

            {/* Section 5: Copywriting Direction */}
            <RichSection
              title="5. Direction copywriting"
              color="bg-lf-green text-white"
              content={data.copywritingDirectionHtml}
              onChange={(html) => updateSection("copywritingDirectionHtml", html)}
              placeholder="Ton de voix, messages clés, formulations recommandées..."
              collapsed={collapsedSections["copywriting"] ?? false}
              onToggle={() => toggleSection("copywriting")}
              onGenerate={() => generateSection("copywriting")}
              generating={generatingSection === "copywriting"}
            />

            {/* Section 6: Visual Style */}
            <RichSection
              title="6. Recommandations style visuel"
              color="bg-purple-600 text-white"
              content={data.visualStyleHtml}
              onChange={(html) => updateSection("visualStyleHtml", html)}
              placeholder="Palette de couleurs, typographie, imagerie, mood..."
              collapsed={collapsedSections["visual_style"] ?? false}
              onToggle={() => toggleSection("visual_style")}
              onGenerate={() => generateSection("visual_style")}
              generating={generatingSection === "visual_style"}
            />

            {/* Section 7: References */}
            <RichSection
              title="7. Références & Documents"
              color="bg-gray-700 text-white"
              content={data.referencesHtml}
              onChange={(html) => updateSection("referencesHtml", html)}
              placeholder="Liens, documents, exemples visuels..."
              collapsed={collapsedSections["references"] ?? false}
              onToggle={() => toggleSection("references")}
              onGenerate={() => generateSection("references")}
              generating={generatingSection === "references"}
            />
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
