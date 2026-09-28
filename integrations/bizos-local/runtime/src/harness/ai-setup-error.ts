/** Failures the owner can resolve by connecting or selecting an AI source. */
export function aiSetupRequired(reason: string): boolean {
  return /(?:\b(?:codex|claude|cursor-agent)\b.*(?:isn't installed|isn't configured|not signed in|not logged in|not authenticated|sign in|log in|authentication|auth_required)|(?:authentication required|auth_required|login required|not signed in|not logged in|not authenticated)|selected (?:personal )?plan (?:was removed|is unavailable|is not connected)|selected inference provider was removed|(?:api key|provider key) (?:is )?(?:missing|not configured|invalid))/i.test(reason);
}
