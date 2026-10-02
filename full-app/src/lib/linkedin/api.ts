/**
 * LinkedIn Posts API client — versioned /rest/posts (NOT the legacy /v2/ugcPosts).
 *
 * Doc: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 * Scope required: w_member_social
 */

const LINKEDIN_POSTS_URL = "https://api.linkedin.com/rest/posts";
const LINKEDIN_API_VERSION = "202604";

export type PublishErrorCode =
  | "TOKEN_EXPIRED"
  | "RATE_LIMITED"
  | "CONTENT_POLICY"
  | "API_ERROR"
  | "NETWORK_ERROR";

export class PublishError extends Error {
  code: PublishErrorCode;
  httpStatus?: number;
  linkedinDetail?: string;
  constructor(code: PublishErrorCode, message: string, httpStatus?: number, detail?: string) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.linkedinDetail = detail;
  }
}

export interface PublishResult {
  postUrn: string;
}

/**
 * Publishes a text-only post on the connected user's LinkedIn feed.
 * Returns the LinkedIn post URN (e.g. urn:li:share:7204000000000000000) on success.
 */
export async function publishTextPost(
  accessToken: string,
  linkedinUserId: string,
  body: string
): Promise<PublishResult> {
  const authorUrn = `urn:li:person:${linkedinUserId}`;

  const payload = {
    author: authorUrn,
    commentary: body,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  let res: Response;
  try {
    res = await fetch(LINKEDIN_POSTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": LINKEDIN_API_VERSION,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new PublishError(
      "NETWORK_ERROR",
      `Network error calling LinkedIn: ${err instanceof Error ? err.message : "unknown"}`
    );
  }

  if (res.status === 401) {
    throw new PublishError("TOKEN_EXPIRED", "Access token expired or invalid", 401);
  }
  if (res.status === 429) {
    throw new PublishError("RATE_LIMITED", "LinkedIn rate limit hit", 429);
  }
  if (res.status === 422) {
    const detail = await res.text().catch(() => "");
    throw new PublishError(
      "CONTENT_POLICY",
      "Post rejected by LinkedIn (content policy)",
      422,
      detail.slice(0, 500)
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PublishError(
      "API_ERROR",
      `LinkedIn API error: HTTP ${res.status}`,
      res.status,
      detail.slice(0, 500)
    );
  }

  // The post URN is returned in the `x-restli-id` header.
  const postUrn = res.headers.get("x-restli-id") ?? "";
  if (!postUrn) {
    throw new PublishError(
      "API_ERROR",
      "LinkedIn returned 2xx but no x-restli-id header",
      res.status
    );
  }
  return { postUrn };
}
