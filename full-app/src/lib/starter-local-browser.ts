import { createQueryClient } from "./starter-local-client";

export function createLocalBrowserClient() {
  return createQueryClient(async (query) => {
    try {
      const response = await fetch("/api/starter/local-query", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query),
      });
      const result = await response.json();
      return response.ok ? result : { data: null, error: { message: result.error?.message || result.error || "Requête locale refusée" } };
    } catch { return { data: null, error: { message: "Le serveur local est indisponible." } }; }
  });
}
