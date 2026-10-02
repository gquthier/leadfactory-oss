import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { createClient, createAdminClient } from "@/lib/supabase-server";

// Argil avatars on fal.ai — UGC style
const UGC_AVATARS = [
  "Mia outdoor", "Ines", "Emma", "Elena", "Vanessa",
  "Laurent", "Noemie car", "Brandon", "Rose", "Ryan podcast",
  "Daniel car", "Matteo",
] as const;

const DEFAULT_AVATAR = "Emma";

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

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    return NextResponse.json({ error: "FAL_KEY not configured" }, { status: 500 });
  }

  fal.config({ credentials: falKey });

  const body = await req.json();
  const { script_segments, avatar_id, voice = "Rachel" } = body as {
    script_segments?: string[];
    avatar_id?: string;
    voice?: string;
  };

  if (!script_segments?.length) {
    return NextResponse.json({ error: "script_segments is required" }, { status: 400 });
  }

  const avatar = UGC_AVATARS.includes(avatar_id as (typeof UGC_AVATARS)[number])
    ? avatar_id!
    : DEFAULT_AVATAR;

  const text = script_segments
    .map((s) => s.replace(/\n/g, " "))
    .join(". ");

  try {
    const result = await fal.subscribe("argil/avatars/text-to-video", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input: { avatar, text, voice } as any,
    });

    const output = result.data as { video: { url: string } };

    return NextResponse.json({
      video_url: output.video.url,
      status: "completed",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
