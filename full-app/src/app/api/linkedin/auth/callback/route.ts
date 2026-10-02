import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { exchangeCodeForTokens, fetchUserInfo } from "@/lib/linkedin/oauth";
import { encryptToken } from "@/lib/linkedin/encryption";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "li_oauth_state";

function redirectWithStatus(status: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://example.invalid";
  return NextResponse.redirect(`${base}/client/settings?tab=integrations&linkedin=${status}`);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    console.warn("[linkedin/callback] LinkedIn returned error:", error, searchParams.get("error_description"));
    return redirectWithStatus(`error_${error}`);
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!code || !state || !storedState || state !== storedState) {
    return redirectWithStatus("csrf_failed");
  }

  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.redirect(
      new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "https://example.invalid")
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const userInfo = await fetchUserInfo(tokens.access_token);

    const now = Date.now();
    const accessEnc = encryptToken(tokens.access_token);
    const refreshEnc = tokens.refresh_token ? encryptToken(tokens.refresh_token) : null;

    const expiresAt = new Date(now + tokens.expires_in * 1000).toISOString();
    const refreshExpiresAt = tokens.refresh_token_expires_in
      ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString()
      : null;

    const composedName = [userInfo.given_name, userInfo.family_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    const fullName = userInfo.name ?? (composedName || null);

    const admin = createAdminClient();
    const { error: upsertError } = await admin
      .from("linkedin_connections")
      .upsert(
        {
          client_id: session.user.id,
          linkedin_user_id: userInfo.sub,
          full_name: fullName,
          profile_picture: userInfo.picture ?? null,
          access_token_encrypted: accessEnc.encrypted,
          access_token_iv: accessEnc.iv,
          access_token_tag: accessEnc.tag,
          refresh_token_encrypted: refreshEnc?.encrypted ?? null,
          refresh_token_iv: refreshEnc?.iv ?? null,
          refresh_token_tag: refreshEnc?.tag ?? null,
          expires_at: expiresAt,
          refresh_expires_at: refreshExpiresAt,
          scopes: tokens.scope.split(" ").filter(Boolean),
          connected_at: new Date(now).toISOString(),
          last_refreshed_at: new Date(now).toISOString(),
          last_error: null,
        },
        { onConflict: "client_id" }
      );

    if (upsertError) {
      console.error("[linkedin/callback] upsert error:", upsertError);
      return redirectWithStatus("db_error");
    }

    return redirectWithStatus("connected");
  } catch (err) {
    console.error("[linkedin/callback] exchange/userinfo failed:", err);
    return redirectWithStatus("exchange_failed");
  }
}
