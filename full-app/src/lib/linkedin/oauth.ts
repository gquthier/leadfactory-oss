export const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"];

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export interface LinkedInTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope: string;
}

export interface LinkedInUserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
  locale?: string;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: requireEnv("LINKEDIN_CLIENT_ID"),
    redirect_uri: requireEnv("LINKEDIN_REDIRECT_URI"),
    state,
    scope: LINKEDIN_SCOPES.join(" "),
  });
  return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<LinkedInTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: requireEnv("LINKEDIN_REDIRECT_URI"),
    client_id: requireEnv("LINKEDIN_CLIENT_ID"),
    client_secret: requireEnv("LINKEDIN_CLIENT_SECRET"),
  });
  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LinkedIn token exchange failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as LinkedInTokens;
}

export async function refreshAccessToken(refreshToken: string): Promise<LinkedInTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: requireEnv("LINKEDIN_CLIENT_ID"),
    client_secret: requireEnv("LINKEDIN_CLIENT_SECRET"),
  });
  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`LinkedIn refresh failed (${res.status}): ${detail.slice(0, 300)}`);
    (err as Error & { code?: string; httpStatus?: number }).code = "REFRESH_FAILED";
    (err as Error & { code?: string; httpStatus?: number }).httpStatus = res.status;
    throw err;
  }
  return (await res.json()) as LinkedInTokens;
}

export async function fetchUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
  const res = await fetch(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LinkedIn userinfo failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as LinkedInUserInfo;
}
