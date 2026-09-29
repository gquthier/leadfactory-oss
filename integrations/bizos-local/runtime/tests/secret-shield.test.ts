import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalProtectedPath,
  claudeDenySettings,
  cliCredentialPaths,
  codexShieldConfig,
  runtimeProtectedPaths,
  seatbeltAvailable,
  seatbeltDenyReadProfile,
  seatbeltLaunch,
  secretShieldEnabled,
  windowsCliExecutionBlocked,
} from "../src/harness/secret-shield.js";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "shield-")));
  mkdirSync(join(root, "state", "runtime", "workspaces", "Agents", "Sales"), { recursive: true });
  mkdirSync(join(root, "state", "runtime", "plans", "p1", "codex"), { recursive: true });
  mkdirSync(join(root, "public"), { recursive: true });
  writeFileSync(join(root, "local-harness.json"), '{"bearer":"OWNER-SECRET"}\n');
  writeFileSync(join(root, "state", "runtime", "providers.json"), '{"openrouter":"sk-SECRET"}\n');
  writeFileSync(join(root, "state", "runtime", "plans", "p1", "codex", "auth.json"), '{"token":"PLAN-SECRET"}\n');
  writeFileSync(join(root, "state", "runtime", "workspaces", "Agents", "Sales", "notes.md"), "public notes\n");
  writeFileSync(join(root, "public", "file.txt"), "PUBLIC\n");
  return root;
}

describe("the protected list", () => {
  it("names the runtime secrets but never the agents' workspaces", () => {
    const root = fixture();
    try {
      const paths = runtimeProtectedPaths({
        storageRoot: join(root, "state", "runtime"),
        stateRoot: join(root, "state"),
        descriptorPath: join(root, "local-harness.json"),
        boatKeyFile: join(root, "boat.key"),
        extra: [join(root, "cookies"), "", "   "],
        home: root,
      });
      expect(paths).toContain(join(root, "local-harness.json"));
      expect(paths).toContain(join(root, "state", "runtime", "providers.json"));
      expect(paths).toContain(join(root, "state", "runtime", "plans"));
      expect(paths).toContain(join(root, "state", "runtime", "mcp"));
      expect(paths).toContain(join(root, "boat.key"));
      expect(paths).toContain(join(root, "cookies"));
      expect(paths).toContain(join(root, "Library", "Application Support", "BizOS-Simple", "Cookies"));
      expect(paths).not.toContain(join(root, "state", "runtime"));
      expect(paths).not.toContain(join(root, "state"));
      expect(paths.some((path) => path.includes("workspaces"))).toBe(false);
      expect(new Set(paths).size).toBe(paths.length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the running CLI's own credentials out of ITS outer seatbelt and denies the other CLI's", () => {
    const home = "/Users/fixture";
    const both = cliCredentialPaths({ home });
    expect(both).toEqual([join(home, ".codex", "auth.json"), join(home, ".claude", ".credentials.json")]);
    expect(cliCredentialPaths({ home, own: "codex" })).toEqual([join(home, ".claude", ".credentials.json")]);
    expect(cliCredentialPaths({ home, own: "claude", codexHome: "/plans/p1/codex" })).toEqual(["/plans/p1/codex/auth.json"]);
  });

  it("resolves symlinked spellings to what the kernel sees", () => {
    expect(canonicalProtectedPath("/tmp")).toBe(realpathSync("/tmp"));
    expect(canonicalProtectedPath("/definitely/missing/path/x.json")).toBe("/definitely/missing/path/x.json");
  });

  it("has one support escape hatch", () => {
    expect(secretShieldEnabled({})).toBe(true);
    expect(secretShieldEnabled({ LOCALBIZOS_SECRET_SHIELD: "0" })).toBe(false);
    expect(secretShieldEnabled({ LOCALBIZOS_SECRET_SHIELD: "off" })).toBe(false);
    expect(secretShieldEnabled({ LOCALBIZOS_SECRET_SHIELD: "1" })).toBe(true);
  });

  it("blocks Windows CLI turns regardless of the support escape hatch", () => {
    expect(windowsCliExecutionBlocked("win32")).toBe(true);
    expect(windowsCliExecutionBlocked("darwin")).toBe(false);
    expect(windowsCliExecutionBlocked("linux")).toBe(false);
  });
});

describe("the Claude deny rules", () => {
  it("cover every path-taking tool for the path and everything under it", () => {
    const settings = claudeDenySettings(["/a/providers.json", "/a/plans", "/a/plans"]);
    expect(settings.permissions.deny).toEqual([
      "Read(/a/providers.json)", "Read(/a/providers.json/**)",
      "Edit(/a/providers.json)", "Edit(/a/providers.json/**)",
      "Write(/a/providers.json)", "Write(/a/providers.json/**)",
      "Glob(/a/providers.json)", "Glob(/a/providers.json/**)",
      "Grep(/a/providers.json)", "Grep(/a/providers.json/**)",
      "Read(/a/plans)", "Read(/a/plans/**)",
      "Edit(/a/plans)", "Edit(/a/plans/**)",
      "Write(/a/plans)", "Write(/a/plans/**)",
      "Glob(/a/plans)", "Glob(/a/plans/**)",
      "Grep(/a/plans)", "Grep(/a/plans/**)",
    ]);
  });
});

describe("the codex permission profile", () => {
  it("mirrors workspace-write (cwd, shared roots, tmp, network) and denies the secrets", () => {
    const config = codexShieldConfig({
      cwd: "/work/Agents/Sales",
      sandbox: "workspace-write",
      writableRoots: ["/Users/x/Clients"],
      networkAccess: true,
      excludeSlashTmp: false,
      excludeTmpdirEnvVar: true,
      tmpdir: "/var/folders/xx/T",
      protectedPaths: ["/state/local-harness.json", "/state/runtime/providers.json"],
    }) as { default_permissions: string; permissions: Record<string, { filesystem: Record<string, string>; network: { enabled: boolean } }> };
    expect(config.default_permissions).toBe("bizos_shield");
    const profile = config.permissions.bizos_shield!;
    expect(profile.filesystem["/"]).toBe("read");
    expect(profile.filesystem["/work/Agents/Sales"]).toBe("write");
    expect(profile.filesystem["/Users/x/Clients"]).toBe("write");
    expect(profile.filesystem[realpathSync("/tmp")]).toBe("write");
    expect(profile.filesystem["/var/folders/xx/T"]).toBeUndefined();
    expect(profile.filesystem["/state/local-harness.json"]).toBe("deny");
    expect(profile.filesystem["/state/runtime/providers.json"]).toBe("deny");
    expect(profile.network).toEqual({ enabled: true });
  });

  it("is read-only everywhere in read-only mode, network closed", () => {
    const config = codexShieldConfig({ cwd: "/work", sandbox: "read-only", protectedPaths: ["/secret"] }) as {
      permissions: Record<string, { filesystem: Record<string, string>; network: { enabled: boolean } }>;
    };
    expect(config.permissions.bizos_shield!.filesystem).toEqual({ "/": "read", "/secret": "deny" });
    expect(config.permissions.bizos_shield!.network).toEqual({ enabled: false });
  });
});

describe("the seatbelt profile", () => {
  it("allows everything but the listed paths, files and folders alike", () => {
    const profile = seatbeltDenyReadProfile(["/a/secret.json", '/b/with"quote']);
    expect(profile.startsWith("(version 1)\n(allow default)\n")).toBe(true);
    expect(profile).toContain('(deny file-read* (literal "/a/secret.json") (subpath "/a/secret.json"))');
    expect(profile).toContain('(literal "/b/with\\"quote")');
  });

  it("wraps the launch only where sandbox-exec exists", () => {
    const linux = seatbeltLaunch("/usr/local/bin/codex", ["app-server"], "(version 1)", "linux");
    expect(linux).toEqual({ command: "/usr/local/bin/codex", args: ["app-server"], sandboxed: false });
    if (!seatbeltAvailable()) return;
    const darwin = seatbeltLaunch("/usr/local/bin/codex", ["app-server"], "(version 1)");
    expect(darwin).toEqual({ command: "/usr/bin/sandbox-exec", args: ["-p", "(version 1)", "/usr/local/bin/codex", "app-server"], sandboxed: true });
  });

  it.skipIf(!seatbeltAvailable())("really stops a command from reading the protected files, symlinked path included", () => {
    const root = fixture();
    try {
      const paths = runtimeProtectedPaths({
        storageRoot: join(root, "state", "runtime"),
        stateRoot: join(root, "state"),
        descriptorPath: join(root, "local-harness.json"),
        home: root,
      });
      const profile = seatbeltDenyReadProfile(paths);
      const run = (file: string) => spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/bin/cat", file], { encoding: "utf8" });
      const descriptor = run(join(root, "local-harness.json"));
      expect(descriptor.status).not.toBe(0);
      expect(descriptor.stdout).not.toContain("OWNER-SECRET");
      const providers = run(join(root, "state", "runtime", "providers.json"));
      expect(providers.status).not.toBe(0);
      expect(providers.stdout).not.toContain("sk-SECRET");
      const plan = run(join(root, "state", "runtime", "plans", "p1", "codex", "auth.json"));
      expect(plan.status).not.toBe(0);
      expect(plan.stdout).not.toContain("PLAN-SECRET");
      // The same file through a symlinked directory is still denied.
      const link = join(root, "link");
      spawnSync("/bin/ln", ["-s", join(root, "state"), link]);
      const viaLink = run(join(link, "runtime", "providers.json"));
      expect(viaLink.status).not.toBe(0);
      expect(viaLink.stdout).not.toContain("sk-SECRET");
      // Everything else — the agent's workspace, other files — still reads.
      expect(run(join(root, "state", "runtime", "workspaces", "Agents", "Sales", "notes.md")).stdout).toBe("public notes\n");
      expect(run(join(root, "public", "file.txt")).stdout).toBe("PUBLIC\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
