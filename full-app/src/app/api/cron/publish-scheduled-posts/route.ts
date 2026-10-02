import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { decryptToken, encryptToken } from "@/lib/linkedin/encryption";
import { refreshAccessToken } from "@/lib/linkedin/oauth";
import { publishTextPost, PublishError } from "@/lib/linkedin/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_RETRY = 3;
// Backoff per retry index: 5 min, 30 min, 2 hours.
const BACKOFF_MINUTES = [5, 30, 120];
// Refresh access_token proactively when it expires in less than this window.
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
// How many posts to dispatch per tick.
const BATCH_SIZE = 10;

type Outcome =
  | "success"
  | "token_expired"
  | "refresh_failed"
  | "rate_limited"
  | "content_policy"
  | "api_error"
  | "network_error";

interface ScheduledRow {
  id: string;
  client_id: string;
  body_snapshot: string;
  retry_count: number;
}

interface ConnectionRow {
  linkedin_user_id: string;
  access_token_encrypted: string;
  access_token_iv: string;
  access_token_tag: string;
  refresh_token_encrypted: string | null;
  refresh_token_iv: string | null;
  refresh_token_tag: string | null;
  expires_at: string;
}

async function logAttempt(
  admin: ReturnType<typeof createAdminClient>,
  scheduledPostId: string,
  outcome: Outcome,
  durationMs: number,
  options: { httpStatus?: number; linkedinError?: string; postUrn?: string } = {}
) {
  await admin.from("post_publish_attempts").insert({
    scheduled_post_id: scheduledPostId,
    outcome,
    http_status: options.httpStatus ?? null,
    linkedin_error: options.linkedinError ?? null,
    linkedin_post_urn: options.postUrn ?? null,
    duration_ms: durationMs,
  });
}

async function loadAccessToken(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  conn: ConnectionRow
): Promise<string> {
  let accessToken = decryptToken({
    encrypted: conn.access_token_encrypted,
    iv: conn.access_token_iv,
    tag: conn.access_token_tag,
  });

  const expiresAtMs = new Date(conn.expires_at).getTime();
  const remainingMs = expiresAtMs - Date.now();

  // If the access token expires soon (or already did), refresh it.
  const needsRefresh = remainingMs < REFRESH_THRESHOLD_MS;
  const hasRefreshToken =
    conn.refresh_token_encrypted &&
    conn.refresh_token_iv &&
    conn.refresh_token_tag;

  if (needsRefresh && hasRefreshToken) {
    const refreshToken = decryptToken({
      encrypted: conn.refresh_token_encrypted!,
      iv: conn.refresh_token_iv!,
      tag: conn.refresh_token_tag!,
    });
    const newTokens = await refreshAccessToken(refreshToken);
    accessToken = newTokens.access_token;

    const newAccessEnc = encryptToken(newTokens.access_token);
    const newRefreshEnc = newTokens.refresh_token
      ? encryptToken(newTokens.refresh_token)
      : null;

    const updatePayload: Record<string, unknown> = {
      access_token_encrypted: newAccessEnc.encrypted,
      access_token_iv: newAccessEnc.iv,
      access_token_tag: newAccessEnc.tag,
      expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
      last_refreshed_at: new Date().toISOString(),
      last_error: null,
    };
    if (newRefreshEnc) {
      updatePayload.refresh_token_encrypted = newRefreshEnc.encrypted;
      updatePayload.refresh_token_iv = newRefreshEnc.iv;
      updatePayload.refresh_token_tag = newRefreshEnc.tag;
      if (newTokens.refresh_token_expires_in) {
        updatePayload.refresh_expires_at = new Date(
          Date.now() + newTokens.refresh_token_expires_in * 1000
        ).toISOString();
      }
    }

    await admin
      .from("linkedin_connections")
      .update(updatePayload)
      .eq("client_id", clientId);
  }

  return accessToken;
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Fetch posts that are due:
  //   status='queued' AND scheduled_at <= NOW()
  //   AND (next_retry_at IS NULL OR next_retry_at <= NOW())
  const { data: posts, error: queryError } = await admin
    .from("scheduled_posts")
    .select("id, client_id, body_snapshot, retry_count")
    .eq("status", "queued")
    .lte("scheduled_at", now)
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (queryError) {
    console.error("[publish-scheduled-posts] query error:", queryError);
    return NextResponse.json(
      { published: 0, failed: 0, queryError: queryError.message },
      { status: 500 }
    );
  }

  const due = (posts ?? []) as ScheduledRow[];
  console.log(`[publish-scheduled-posts] ${due.length} posts due`);

  let published = 0;
  let failed = 0;
  let skipped = 0;

  for (const post of due) {
    const start = Date.now();

    // Claim the post immediately to prevent another tick from picking it up.
    const { data: claimed, error: claimError } = await admin
      .from("scheduled_posts")
      .update({ status: "publishing" })
      .eq("id", post.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();

    if (claimError || !claimed) {
      skipped++;
      continue;
    }

    // Load the user's LinkedIn connection.
    const { data: conn } = await admin
      .from("linkedin_connections")
      .select(
        "linkedin_user_id, access_token_encrypted, access_token_iv, access_token_tag, refresh_token_encrypted, refresh_token_iv, refresh_token_tag, expires_at"
      )
      .eq("client_id", post.client_id)
      .maybeSingle();

    if (!conn) {
      await admin
        .from("scheduled_posts")
        .update({
          status: "failed",
          error_message: "Aucune connexion LinkedIn — reconnectez votre compte.",
        })
        .eq("id", post.id);
      await logAttempt(admin, post.id, "refresh_failed", Date.now() - start, {
        linkedinError: "no linkedin_connections row",
      });
      failed++;
      continue;
    }

    let accessToken: string;
    try {
      accessToken = await loadAccessToken(admin, post.client_id, conn as ConnectionRow);
    } catch (err) {
      const duration = Date.now() - start;
      const message = err instanceof Error ? err.message : "refresh failed";
      await admin
        .from("linkedin_connections")
        .update({ last_error: message.slice(0, 500) })
        .eq("client_id", post.client_id);
      await admin
        .from("scheduled_posts")
        .update({
          status: "failed",
          error_message: "Token LinkedIn révoqué. Reconnectez votre compte.",
        })
        .eq("id", post.id);
      await logAttempt(admin, post.id, "refresh_failed", duration, {
        linkedinError: message.slice(0, 500),
      });
      failed++;
      continue;
    }

    // Publish.
    try {
      const { postUrn } = await publishTextPost(
        accessToken,
        (conn as ConnectionRow).linkedin_user_id,
        post.body_snapshot
      );
      const duration = Date.now() - start;
      await admin
        .from("scheduled_posts")
        .update({
          status: "published",
          linkedin_post_urn: postUrn,
          published_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", post.id);
      await logAttempt(admin, post.id, "success", duration, { postUrn });
      published++;
    } catch (err) {
      const duration = Date.now() - start;
      const newRetryCount = post.retry_count + 1;
      let outcome: Outcome = "api_error";
      let httpStatus: number | undefined;
      let detail: string | undefined;
      let terminal = false;

      if (err instanceof PublishError) {
        outcome = err.code.toLowerCase() as Outcome;
        httpStatus = err.httpStatus;
        detail = err.linkedinDetail;
        // Content-policy violations and any 4xx not in retry list are terminal.
        if (err.code === "CONTENT_POLICY") terminal = true;
        // TOKEN_EXPIRED is unusual at this point (we just refreshed) — treat
        // it as terminal so we don't loop. Worker will surface to user.
        if (err.code === "TOKEN_EXPIRED") terminal = true;
      }

      const reachedMax = newRetryCount >= MAX_RETRY;
      if (terminal || reachedMax) {
        await admin
          .from("scheduled_posts")
          .update({
            status: "failed",
            retry_count: newRetryCount,
            error_message: detail?.slice(0, 500) ?? (err instanceof Error ? err.message : "Erreur inconnue"),
          })
          .eq("id", post.id);
        failed++;
      } else {
        const backoffMin =
          BACKOFF_MINUTES[Math.min(newRetryCount - 1, BACKOFF_MINUTES.length - 1)];
        const nextRetryAt = new Date(Date.now() + backoffMin * 60 * 1000).toISOString();
        await admin
          .from("scheduled_posts")
          .update({
            status: "queued",
            retry_count: newRetryCount,
            next_retry_at: nextRetryAt,
            error_message: detail?.slice(0, 500) ?? (err instanceof Error ? err.message : "Erreur inconnue"),
          })
          .eq("id", post.id);
      }

      await logAttempt(admin, post.id, outcome, duration, {
        httpStatus,
        linkedinError: detail?.slice(0, 500) ?? (err instanceof Error ? err.message : "unknown"),
      });
    }
  }

  return NextResponse.json({ published, failed, skipped, processed: due.length });
}
