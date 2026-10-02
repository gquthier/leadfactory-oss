import {
  getCanonicalCampaignStatus,
  type CampaignStatus,
  type CanonicalCampaignStatus,
  type LegacyCampaignStatus,
} from "@/types/index";

export function getLegacyCampaignStatus(
  input: CampaignStatus | CanonicalCampaignStatus | string | null | undefined
): LegacyCampaignStatus {
  switch (getCanonicalCampaignStatus(input)) {
    case "brief_received":
      return "onboarding";
    case "campaign_proposal":
      return "setup";
    case "ad_creative":
      return "creative_review";
    case "meta_account_setup":
      return "setup";
    case "live_optimizing":
      return "live";
    case "reworks":
      return "creative_review";
    case "paused":
      return "live";
    case "completed_project":
      return "completed";
  }
}

export function getCampaignStatusWriteCandidates(
  input: CampaignStatus | CanonicalCampaignStatus | string | null | undefined
): Array<CanonicalCampaignStatus | LegacyCampaignStatus> {
  const canonical = getCanonicalCampaignStatus(input);
  const legacy = getLegacyCampaignStatus(canonical);
  return Array.from(new Set<CanonicalCampaignStatus | LegacyCampaignStatus>([canonical, legacy]));
}

export function isCampaignStatusEnumError(message: string | null | undefined): boolean {
  const normalized = (message ?? "").toLowerCase();
  return normalized.includes("invalid input value for enum campaign_status");
}
