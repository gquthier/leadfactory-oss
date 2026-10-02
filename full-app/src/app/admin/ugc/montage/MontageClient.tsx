"use client";

import { useState } from "react";
import { Sparkles, Copy, Check, Loader2, Video, RefreshCw, Volume2, Download, Film } from "lucide-react";

// Argil UGC avatars available on fal.ai
const AVATARS = [
  { id: "Emma", label: "Emma (UGC)" },
  { id: "Ines", label: "Ines (UGC)" },
  { id: "Elena", label: "Elena (UGC)" },
  { id: "Vanessa", label: "Vanessa (UGC)" },
  { id: "Rose", label: "Rose (UGC)" },
  { id: "Mia outdoor", label: "Mia outdoor (UGC)" },
  { id: "Noemie car", label: "Noemie voiture (UGC)" },
  { id: "Brandon", label: "Brandon (UGC, homme)" },
  { id: "Laurent", label: "Laurent (UGC, homme)" },
  { id: "Matteo", label: "Matteo (UGC, homme)" },
];

const DEFAULT_SCRIPT = "VOTRE ACCROCHE\n---\nLE PROBLÈME CLIENT\n---\nVOTRE SOLUTION\n---\nPREUVE AUTORISÉE\n---\nAPPEL À L’ACTION";
const DEFAULT_PRODUCT = "Produit à renseigner";
const DEFAULT_CONTEXT = "Renseignez votre marque, votre offre et ses preuves autorisées. Aucun tarif, résultat ou témoignage n’est fourni par défaut.";

const VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel (FR/EN, clair)" },
  { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi (EN, énergique)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella (EN, douce)" },
  { id: "ErXwobaYiN019PkySvjV", label: "Antoni (EN, masculin)" },
];

export function MontageClient() {
  const [product, setProduct] = useState(DEFAULT_PRODUCT);
  const [context, setContext] = useState(DEFAULT_CONTEXT);
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [scriptStatus, setScriptStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [scriptError, setScriptError] = useState("");
  const [copied, setCopied] = useState(false);

  const [ttsStatus, setTtsStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [ttsError, setTtsError] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);

  const [videoStatus, setVideoStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0].id);

  const generateScript = async () => {
    setScriptStatus("loading");
    setScriptError("");

    try {
      const res = await fetch("/api/admin/ugc/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, context, numSegments: 7 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      setScript(data.script);
      setScriptStatus("done");
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : String(err));
      setScriptStatus("error");
    }
  };

  const generateTTS = async () => {
    setTtsStatus("loading");
    setTtsError("");
    setAudioUrl(null);

    const spokenText = script
      .split("---")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((seg) => seg.replace(/\n/g, " "))
      .join(". ");

    try {
      const res = await fetch("/api/admin/ugc/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: spokenText, voiceId: selectedVoice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      setAudioUrl(data.audioData);
      setTtsStatus("done");
    } catch (err) {
      setTtsError(err instanceof Error ? err.message : String(err));
      setTtsStatus("error");
    }
  };

  const generateVideo = async () => {
    setVideoStatus("loading");
    setVideoError("");
    setVideoUrl(null);

    try {
      const res = await fetch("/api/admin/ugc/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script_segments: segments, avatar_id: selectedAvatar }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      setVideoUrl(data.video_url);
      setVideoStatus("done");
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : String(err));
      setVideoStatus("error");
    }
  };

  const downloadAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `ugc-voiceover-${Date.now()}.mp3`;
    a.click();
  };

  const copyScript = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const segments = script
    .split("---")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Video className="w-6 h-6 text-purple-400" />
          UGC Studio
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Génère des scripts UGC + voiceover IA pour tes ads verticales
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input + TTS */}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-300 block mb-1">
              Produit / Service
            </label>
            <input
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              placeholder="Ex: Marque Exemple, Mon App, Ma Marque..."
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-300 block mb-1">
              Contexte / Description
            </label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white text-sm resize-none focus:outline-none focus:border-purple-500"
              placeholder="Décris ton produit, ses avantages, le prix, la cible..."
            />
          </div>

          <button
            onClick={generateScript}
            disabled={scriptStatus === "loading"}
            className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
          >
            {scriptStatus === "loading" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Génération IA...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Générer le script
              </>
            )}
          </button>

          {scriptStatus === "error" && (
            <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
              {scriptError}
            </div>
          )}
          {scriptStatus === "done" && (
            <div className="p-3 bg-green-900/40 border border-green-700 rounded-lg text-green-300 text-sm flex items-center gap-2">
              <Check className="w-4 h-4" />
              Script généré !
            </div>
          )}

          {/* TTS Section */}
          <div className="border-t border-gray-800 pt-4 space-y-3">
            <p className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-blue-400" />
              Voiceover ElevenLabs
            </p>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Voix</label>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={generateTTS}
              disabled={ttsStatus === "loading" || !script.trim()}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              {ttsStatus === "loading" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Génération voiceover...
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4" />
                  Générer le voiceover
                </>
              )}
            </button>

            {ttsStatus === "error" && (
              <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
                {ttsError}
              </div>
            )}

            {ttsStatus === "done" && audioUrl && (
              <div className="space-y-2">
                <div className="p-3 bg-blue-900/40 border border-blue-700 rounded-lg text-blue-300 text-sm flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  Voiceover prêt !
                </div>
                <audio controls src={audioUrl} className="w-full" />
                <button
                  onClick={downloadAudio}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Télécharger MP3
                </button>
              </div>
            )}
          </div>

          {/* Video UGC Section */}
          <div className="border-t border-gray-800 pt-4 space-y-3">
            <p className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <Film className="w-4 h-4 text-green-400" />
              Vidéo UGC Argil
            </p>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Avatar</label>
              <select
                value={selectedAvatar}
                onChange={(e) => setSelectedAvatar(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
              >
                {AVATARS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={generateVideo}
              disabled={videoStatus === "loading" || !script.trim()}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              {videoStatus === "loading" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Génération vidéo en cours... (30-60s)
                </>
              ) : (
                <>
                  <Film className="w-4 h-4" />
                  Générer la vidéo UGC
                </>
              )}
            </button>

            {videoStatus === "error" && (
              <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
                {videoError}
              </div>
            )}

            {videoStatus === "done" && videoUrl && (
              <div className="space-y-2">
                <div className="p-3 bg-green-900/40 border border-green-700 rounded-lg text-green-300 text-sm flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  Vidéo générée !
                </div>
                <video src={videoUrl} controls className="w-full rounded-lg mt-4" />
              </div>
            )}
          </div>
        </div>

        {/* Right: Script output */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-300">
              Script captions ({segments.length} segments)
            </label>
            <button
              onClick={copyScript}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied ? "Copié !" : "Copier"}
            </button>
          </div>

          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={18}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white text-sm font-mono resize-none focus:outline-none focus:border-purple-500"
            placeholder="Le script apparaîtra ici..."
          />
          <p className="text-xs text-gray-500">
            Chaque bloc séparé par --- = 1 segment caption. Éditable manuellement.
          </p>
        </div>
      </div>

      {/* Segments preview */}
      {segments.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-400 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            Aperçu segments ({segments.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {segments.map((seg, i) => (
              <div
                key={i}
                className="aspect-[9/16] bg-black border border-gray-800 rounded-lg flex items-end justify-center p-2"
              >
                <div className="text-center">
                  {seg.split("\n").map((line, j) => (
                    <p
                      key={j}
                      className="text-white font-black text-xs leading-tight"
                      style={{
                        textShadow: "2px 2px 4px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8)",
                        WebkitTextStroke: "0.5px black",
                      }}
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
