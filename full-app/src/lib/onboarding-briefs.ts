import type { OnboardingResponse } from "@/types/index";

type OnboardingLike = Pick<OnboardingResponse, "responses">;

export function isTestOnboardingResponse(response: OnboardingLike): boolean {
  const responses = (response.responses ?? {}) as Record<string, unknown>;
  const testValue = responses.test;

  return testValue === true || testValue === "true";
}

export function getVisibleOnboardingResponses<T extends OnboardingLike>(
  responses: T[] | null | undefined
): T[] {
  return (responses ?? []).filter((response) => !isTestOnboardingResponse(response));
}
