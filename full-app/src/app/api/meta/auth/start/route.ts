import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase-server";
import { buildAuthUrl } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "fb_oauth_state";
const STATE_TTL_S = 600;

export async function GET() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.redirect(
      new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "https://example.invalid")
    );
  }

  const state = randomBytes(32).toString("hex");

  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_TTL_S,
    path: "/",
  });

  return NextResponse.redirect(buildAuthUrl(state));
}
