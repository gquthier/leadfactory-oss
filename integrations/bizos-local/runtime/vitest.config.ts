import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node", include: ["tests/agency.test.ts", "tests/agency-kit.test.ts", "tests/sidecar-agency.test.ts"] } });
