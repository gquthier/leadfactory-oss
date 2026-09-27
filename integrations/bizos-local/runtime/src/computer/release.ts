/** Local-runtime authority; never set by entitlement, a renderer or a tool call. */
export function localComputerEnabled(): boolean {
  return process.env.BIZOS_LOCAL_COMPUTER_ENABLED === "true";
}
export function assertLocalComputerEnabled(): void {
  if (!localComputerEnabled()) throw new Error("Computer is unavailable in this release.");
}
