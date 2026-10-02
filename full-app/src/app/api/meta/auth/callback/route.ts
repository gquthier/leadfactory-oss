import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getPagesWithTokens,
  getMeId,
  subscribePageToLeadgen,
  META_SCOPES,
} from "@/lib/meta/oauth";
import { encryptToken } from "@/lib/linkedin/encryption";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "fb_oauth_state";

function redirectWithStatus(status: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://example.invalid";
  return NextResponse.redirect(`${base}/client/settings?tab=integrations&meta=${status}`);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    console.warn("[meta/callback] Meta returned error:", error, searchParams.get("error_description"));
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
    const short = await exchangeCodeForToken(code);
    const long = await exchangeForLongLivedToken(short.access_token);
    const userToken = long.access_token;

    const metaUserId = await getMeId(userToken);
    const pages = await getPagesWithTokens(userToken);
    if (pages.length === 0) {
      return redirectWithStatus("no_pages");
    }

    const admin = createAdminClient();

    // Sélection : page déjà liée à une campagne du client, sinon la 1re page.
    let chosen = pages[0];
    const { data: knownCampaigns } = await admin
      .from("campaigns")
      .select("facebook_page_id")
      .eq("client_id", session.user.id)
      .not("facebook_page_id", "is", null);
    const knownPageIds = new Set((knownCampaigns ?? []).map((c) => c.facebook_page_id));
    const match = pages.find((p) => knownPageIds.has(p.id));
    if (match) chosen = match;

    const now = Date.now();
    const expiresAt = long.expires_in ? new Date(now + long.expires_in * 1000).toISOString() : null;
    const userEnc = encryptToken(userToken);
    const pageEnc = encryptToken(chosen.access_token);

    // Auto-abonnement de la page au champ leadgen.
    let subscribed = false;
    try {
      subscribed = await subscribePageToLeadgen(chosen.id, chosen.access_token);
    } catch (e) {
      console.error("[meta/callback] subscribePageToLeadgen failed:", e);
    }

    const { error: upsertError } = await admin.from("meta_connections").upsert(
      {
        client_id: session.user.id,
        meta_user_id: metaUserId,
        page_id: chosen.id,
        page_name: chosen.name,
        instagram_account_id: chosen.instagram_business_account?.id ?? null,
        user_token_encrypted: userEnc.encrypted,
        user_token_iv: userEnc.iv,
        user_token_tag: userEnc.tag,
        page_token_encrypted: pageEnc.encrypted,
        page_token_iv: pageEnc.iv,
        page_token_tag: pageEnc.tag,
        expires_at: expiresAt,
        scopes: META_SCOPES,
        subscribed_leadgen: subscribed,
        connected_at: new Date(now).toISOString(),
        last_refreshed_at: new Date(now).toISOString(),
        last_error: subscribed ? null : "subscribe_leadgen_failed",
      },
      { onConflict: "page_id" }
    );

    if (upsertError) {
      console.error("[meta/callback] upsert error:", upsertError);
      return redirectWithStatus("db_error");
    }

    return redirectWithStatus(subscribed ? "connected" : "connected_no_sub");
  } catch (err) {
    console.error("[meta/callback] exchange/pages failed:", err);
    return redirectWithStatus("exchange_failed");
  }
}
