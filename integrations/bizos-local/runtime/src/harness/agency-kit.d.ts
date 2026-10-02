// Types for the embedded cockpits (`src/agency-kit/lib/app.mjs` and
// `src/agency-kit/ecommerce/lib/app.mjs`, mirrored to `dist/agency-kit/` at
// build time by `scripts/copy-agency-kit.mjs`).
//
// The kits are plain JavaScript shipped verbatim under their MIT licence;
// this declaration is the only TypeScript view of them. Pattern-matched so
// that the same literal relative import resolves from `src/harness` (vitest)
// and from `dist/harness` (the sidecar) alike. Both cockpits honour the SAME
// `createApp` contract (`CONTRACT.md`).
declare module "*/agency-kit/lib/app.mjs" {
  import type { Server } from "node:http";

  export interface AgencyKitApp {
    server: Server;
    /** The single store behind the cockpit; never written to directly here. */
    store: { read(): unknown; close(): Promise<void> };
    connections: unknown;
    dataDir: string;
    publicDir: string;
    close(): Promise<void>;
    /** One-use 64-hex ticket (60 s) for the `#connect=` fragment of a URL a
     * person opens; `POST /api/session { ticket }` turns it into an HttpOnly
     * cookie. Throws when the instance has no `accessToken`. */
    issueDashboardTicket(): string;
  }

  export function createApp(options?: {
    dataDir?: string;
    publicDir?: string;
    /** Names the host in `GET /api/meta`; the UI adapts its Start Here. */
    hostedBy?: "bizos-local" | null;
    /** ≥ 32 characters: every `/api/*` route then requires this bearer or a
     * session cookie. `null` keeps the standalone, unauthenticated cockpit. */
    accessToken?: string | null;
    fetchImpl?: typeof fetch;
    onMutation?: () => Promise<void>;
  }): Promise<AgencyKitApp>;
}

declare module "*/agency-kit/ecommerce/lib/app.mjs" {
  import type { Server } from "node:http";

  export interface EcommerceKitApp {
    server: Server;
    close(): Promise<void>;
    issueDashboardTicket(): string;
  }

  export function createApp(options?: {
    dataDir?: string;
    publicDir?: string;
    hostedBy?: "bizos-local" | null;
    accessToken?: string | null;
    fetchImpl?: typeof fetch;
    onMutation?: () => Promise<void>;
  }): Promise<EcommerceKitApp>;
}
