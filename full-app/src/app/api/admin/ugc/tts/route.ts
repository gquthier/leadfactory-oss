import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// ElevenLabs TTS — converts UGC script to voiceover audio
// Uses the first available ElevenLabs voice (Rachel — clear, professional)
const ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "admin")
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const body = await req.json();
  const { text, voiceId } = body as { text?: string; voiceId?: string };

  if (!text?.trim()) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
  }

  const targetVoiceId = voiceId ?? ELEVENLABS_VOICE_ID;

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${targetVoiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `ElevenLabs error: ${response.status} — ${errText}` },
        { status: 500 }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString("base64");

    return NextResponse.json({
      audioData: `data:audio/mpeg;base64,${base64Audio}`,
      size: audioBuffer.byteLength,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
