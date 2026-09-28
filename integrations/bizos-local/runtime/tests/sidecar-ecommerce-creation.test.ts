// Exercise a NEW E-commerce company over the real sidecar HTTP contract.
// HOME, state and CLI discovery are isolated from the host profile.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidecar = join(runtimeRoot, "dist", "sidecar.js");
const built = existsSync(sidecar) && existsSync(join(runtimeRoot, "dist", "agency-kit", "ecommerce", "template.json"));

let temp: string;
let child: ChildProcess;
let descriptor: { origin: string; token: string };

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(new URL(path, descriptor.origin), {
    method,
    headers: {
      authorization: `Bearer ${descriptor.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

describe.skipIf(!built)("new E-commerce company on a running sidecar", () => {
  beforeAll(async () => {
    temp = mkdtempSync(join(tmpdir(), "lbz-new-commerce-"));
    const home = join(temp, "home");
    mkdirSync(home, { recursive: true });
    const descriptorPath = join(temp, "desktop", "local-harness.json");
    child = spawn(process.execPath, [sidecar, "serve"], {
      cwd: runtimeRoot,
      env: {
        HOME: home,
        CODEX_HOME: join(temp, "codex"),
        CLAUDE_CONFIG_DIR: join(temp, "claude"),
        PATH: "/usr/bin:/bin",
        TMPDIR: temp,
        LOCALBIZOS_SIDECAR_STATE: join(temp, "state"),
        LOCALBIZOS_SIDECAR_DESCRIPTOR: descriptorPath,
      },
      stdio: "ignore",
    });
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      try {
        descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
        if ((await api("GET", "/api/local/health")).status === 200) return;
      } catch { /* sidecar is still starting */ }
      await new Promise((wait) => setTimeout(wait, 100));
    }
    throw new Error("isolated sidecar did not become healthy");
  }, 45_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((done) => child.once("exit", done));
    }
    if (temp) await rm(temp, { recursive: true, force: true });
  }, 45_000);

  it("creates CEO, dormant roles, a store vault and no scheduled routine", async () => {
    const catalogue = await api("GET", "/api/local/brain/templates");
    expect(catalogue.status).toBe(200);
    expect(catalogue.body.templates.map((row: { id: string }) => row.id)).toContain("ecommerce");

    const request = { id: "ecommerce", rootId: "new", companyName: "Atelier Vélo", owner: { name: "Ada" }, language: "fr" };
    const created = await api("POST", "/api/local/brain/templates/apply", request);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ id: "ecommerce", rootId: "vault:ecommerce", created: true, bots: { ceo: expect.any(String) } });
    expect(Object.keys(created.body.bots)).toEqual(["ceo"]);
    const vault = join(temp, "state", "runtime", "vaults", "ecommerce");
    for (const path of [
      "Agents/CEO/system.md", "Roles/product-research/role.json", "Roles/store-builder/system.md",
      "Roles/creative/system.md", "Roles/acquisition/system.md", "Roles/operations/system.md",
      "Processes/Product research.md", "Products", "skills", "Business.md",
    ]) expect(existsSync(join(vault, path)), path).toBe(true);
    const company = readFileSync(join(vault, "Company.md"), "utf8");
    expect(company).toContain("- Company name: Atelier Vélo");
    expect(company).toContain("- Owner and preferred address: Ada");
    expect(company).toContain("Read Business.md");
    expect(readFileSync(join(vault, "Team.md"), "utf8")).toContain("Only CEO is active");
    const journal = JSON.parse(readFileSync(join(temp, "state", "runtime", "templates.json"), "utf8"));
    expect(journal.installations.ecommerce.routineIds).toEqual([]);
    const bootstrap = await api("GET", "/api/collaboration/bootstrap");
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.agents.map((agent: { name: string }) => agent.name)).toEqual(["CEO"]);
    const repeat = await api("POST", "/api/local/brain/templates/apply", request);
    expect(repeat.body).toMatchObject({ created: false, bots: created.body.bots });
  });
});
