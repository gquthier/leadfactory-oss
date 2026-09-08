import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, sep } from "node:path";
import { deniedDirectories, executableDirectories, normalizeAccess } from "./access.js";
import { codexCandidatePaths } from "./codex-status.js";
import type { Storage } from "./storage.js";
import type {
  AccessSettings,
  PermissionPolicy,
  PlanProviderSetting,
  ReasoningEffort,
  RuntimeSettings,
  SandboxMode,
  ThemePreference,
} from "./types.js";

export const SETTINGS_FILE = "settings.json";

export const DEFAULT_MODEL = "gpt-5.6-sol";

export const REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
export const SANDBOX_MODES: SandboxMode[] = ["read-only", "workspace-write"];
/** `skip-all` turns every approval card off for every agent — see
 * `PermissionPolicy`. The default is, and stays, `ask`. */
export const PERMISSION_POLICIES: PermissionPolicy[] = ["ask", "skip-all"];
export const THEME_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];
/** System, so a Mac that turns dark at sunset takes this window with it. */
export const DEFAULT_THEME: ThemePreference = "system";

/** A model id is handed straight to the CLI (`codex -c model=…` or
 * `claude --model …`). Underscores are allowed so Claude aliases like
 * `claude-sonnet-4-5` fit; anything outside this alphabet is an attempt
 * at an argument, not a model. */
export const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

export const PLAN_PROVIDERS = ["codex", "claude", "cursor"] as const;
/** Opaque plan id shape — mirrors `plan-registry.PLAN_ID`. */
export const ACTIVE_PLAN_ID = /^pln_[a-z0-9]+_[a-z0-9]+$/i;
/** Opaque external provider id — mirrors `inference.PROVIDER_ID`. */
export const INFERENCE_PROVIDER_ID = /^prv_[a-z0-9]{6,40}$/;

/** A refusal the bridge can name (`ipc.runHandler` uses `name` as the code). */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "invalid_settings";
  }
}

export function defaultSettings(): RuntimeSettings {
  return {
    mode: "cloud",
    local: {
      model: DEFAULT_MODEL,
      reasoningEffort: "medium",
      sandbox: "workspace-write",
      autoApproveReads: true,
      permissions: "ask",
    },
    appearance: { theme: DEFAULT_THEME },
    access: { grants: [], fullDiskRead: false },
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Coerce anything read off disk (or handed over IPC) into the contract.
 * An unknown enum value falls back to the default rather than reaching
 * `codex` as an argument nobody validated. Lenient on purpose: this runs on
 * a file that may predate today's rules, and it must never throw. New
 * values go through `validateLocalPatch` first. */
export function normalizeSettings(raw: unknown): RuntimeSettings {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== "object") return defaults;
  const record = raw as Record<string, unknown>;
  const local = (record.local ?? {}) as Record<string, unknown>;
  const theme = (record.appearance as Record<string, unknown> | undefined)?.theme;
  const effort = local.reasoningEffort;
  const sandbox = local.sandbox;
  const permissions = local.permissions;
  const model = nonEmptyString(local.model);
  const activePlanId =
    local.activePlanId === null
      ? null
      : typeof local.activePlanId === "string" && ACTIVE_PLAN_ID.test(local.activePlanId.trim())
        ? local.activePlanId.trim()
        : undefined;
  const provider = PLAN_PROVIDERS.includes(local.provider as PlanProviderSetting)
    ? (local.provider as PlanProviderSetting)
    : undefined;
  const inferenceProviderId =
    local.inferenceProviderId === null
      ? null
      : typeof local.inferenceProviderId === "string" && INFERENCE_PROVIDER_ID.test(local.inferenceProviderId.trim())
        ? local.inferenceProviderId.trim()
        : undefined;
  return {
    mode: record.mode === "local" ? "local" : "cloud",
    local: {
      ...(nonEmptyString(local.codexPath) ? { codexPath: nonEmptyString(local.codexPath) } : {}),
      model: model && MODEL_ID.test(model) ? model : DEFAULT_MODEL,
      reasoningEffort: REASONING_EFFORTS.includes(effort as ReasoningEffort)
        ? (effort as ReasoningEffort)
        : "medium",
      sandbox: SANDBOX_MODES.includes(sandbox as SandboxMode) ? (sandbox as SandboxMode) : "workspace-write",
      ...(nonEmptyString(local.workingDir) ? { workingDir: nonEmptyString(local.workingDir) } : {}),
      autoApproveReads: local.autoApproveReads !== false,
      // A file written before this setting existed asks, like it always did.
      permissions: PERMISSION_POLICIES.includes(permissions as PermissionPolicy)
        ? (permissions as PermissionPolicy)
        : "ask",
      ...(activePlanId !== undefined ? { activePlanId } : {}),
      ...(provider ? { provider } : {}),
      ...(inferenceProviderId !== undefined ? { inferenceProviderId } : {}),
    },
    appearance: {
      // A `settings.json` written before F-THEME has no `appearance` at all, and
      // that is not a corrupt file — it is a machine that has never been asked.
      theme: THEME_PREFERENCES.includes(theme as ThemePreference)
        ? (theme as ThemePreference)
        : DEFAULT_THEME,
    },
    access: normalizeAccess(record.access),
  };
}

export interface SettingsPolicy {
  /** Roots a working directory may live under. */
  allowedRoots: string[];
  /** Folders a working directory may never be, or contain: the deny list and
   * the folders this Mac runs programs from. The bots' folder is the codex
   * `cwd`, and `cwd` is writable in `workspace-write` — so pointing it at
   * `~/Library/Application Support` or `~/.local/bin` is the same door that
   * `access.ts` closes for shared folders. */
  forbiddenRoots: string[];
  /** The `codex` binaries this Mac actually has. A path outside this list
   * is refused: `codexPath` is spawned, so a renderer able to name any file
   * is a renderer able to run any file, outside the codex sandbox. */
  codexCandidates(): string[];
  realpath(path: string): string;
  isExecutable(path: string): boolean;
  isDirectory(path: string): boolean;
}

/** Roots are compared against a `realpath`ed candidate, so they have to be
 * canonical too: on macOS `/var/folders/...` really is
 * `/private/var/folders/...`, and a raw prefix test would refuse a folder
 * that is genuinely inside an allowed root. */
function canonicalRoot(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function defaultSettingsPolicy(
  extraRoots: string[] = [],
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  extraDenied: string[] = [],
): SettingsPolicy {
  return {
    allowedRoots: [...new Set([home, ...extraRoots].map(canonicalRoot))],
    forbiddenRoots: [
      ...new Set(
        [...deniedDirectories(home, extraDenied), ...executableDirectories(home)].map(canonicalRoot),
      ),
    ],
    codexCandidates: () => codexCandidatePaths(environment),
    realpath: (path) => realpathSync(path),
    isExecutable: (path) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** Check the values a caller is trying to WRITE. Throws `SettingsError`,
 * never coerces: silently swapping a rejected path for a default would tell
 * the user their choice was accepted. */
export function validateLocalPatch(local: Record<string, unknown>, policy: SettingsPolicy): void {
  if ("codexPath" in local && local.codexPath !== undefined && local.codexPath !== null) {
    if (typeof local.codexPath !== "string") throw new SettingsError("codexPath must be a string");
    const raw = local.codexPath.trim();
    if (raw) {
      if (!isAbsolute(raw)) throw new SettingsError("codexPath must be an absolute path");
      let canonical: string;
      try {
        canonical = policy.realpath(raw);
      } catch {
        throw new SettingsError(`there is no file at ${raw}`);
      }
      if (!policy.isExecutable(canonical)) throw new SettingsError(`${raw} is not executable`);
      // The CANONICAL path is what gets persisted and what gets spawned, so a
      // value that is not already canonical is a symlink — and a symlink can be
      // repointed between "Save" and the next turn.
      if (canonical !== raw) {
        throw new SettingsError(`${raw} is a link, not a program — pick ${canonical}`);
      }
      const candidates = policy.codexCandidates();
      if (!candidates.includes(canonical)) {
        throw new SettingsError(
          `${raw} is not one of the codex installations found on this Mac — pick one of: ${
            candidates.join(", ") || "(none found)"
          }`,
        );
      }
    }
  }

  if ("workingDir" in local && local.workingDir !== undefined && local.workingDir !== null) {
    if (typeof local.workingDir !== "string") throw new SettingsError("workingDir must be a string");
    const raw = local.workingDir.trim();
    if (raw) {
      if (!isAbsolute(raw)) throw new SettingsError("workingDir must be an absolute path");
      let canonical: string;
      try {
        canonical = policy.realpath(raw);
      } catch {
        throw new SettingsError(`there is no folder at ${raw}`);
      }
      if (!policy.isDirectory(canonical)) throw new SettingsError(`${raw} is not a folder`);
      if (!policy.allowedRoots.some((root) => within(canonical, root))) {
        throw new SettingsError("the bots' folder must live inside your home folder");
      }
      for (const forbidden of policy.forbiddenRoots) {
        if (within(canonical, forbidden) || within(forbidden, canonical)) {
          throw new SettingsError(`${raw} is a folder this app never works from`);
        }
      }
    }
  }

  if ("model" in local && local.model !== undefined && local.model !== null) {
    if (typeof local.model !== "string" || !MODEL_ID.test(local.model.trim())) {
      throw new SettingsError("that model id is not a model id");
    }
  }

  if ("reasoningEffort" in local && local.reasoningEffort !== undefined) {
    if (!REASONING_EFFORTS.includes(local.reasoningEffort as ReasoningEffort)) {
      throw new SettingsError("unknown reasoning effort");
    }
  }

  if ("sandbox" in local && local.sandbox !== undefined) {
    if (!SANDBOX_MODES.includes(local.sandbox as SandboxMode)) {
      throw new SettingsError("unknown sandbox mode");
    }
  }

  if ("permissions" in local && local.permissions !== undefined) {
    if (!PERMISSION_POLICIES.includes(local.permissions as PermissionPolicy)) {
      throw new SettingsError('permissions must be "ask" or "skip-all"');
    }
  }

  if ("provider" in local && local.provider !== undefined && local.provider !== null) {
    if (!PLAN_PROVIDERS.includes(local.provider as PlanProviderSetting)) {
      throw new SettingsError("unknown plan provider");
    }
  }

  if ("activePlanId" in local) {
    if (local.activePlanId === null) {
      /* clear */
    } else if (typeof local.activePlanId !== "string" || !ACTIVE_PLAN_ID.test(local.activePlanId.trim())) {
      throw new SettingsError("activePlanId must be a pln_… id or null");
    }
  }

  if ("inferenceProviderId" in local) {
    if (local.inferenceProviderId === null) {
      /* clear */
    } else if (typeof local.inferenceProviderId !== "string" || !INFERENCE_PROVIDER_ID.test(local.inferenceProviderId.trim())) {
      throw new SettingsError("inferenceProviderId must be a prv_… id or null");
    }
  }
}

/** `access` is deliberately NOT mergeable from a patch: it is written only
 * by the `access` calls, which canonicalize every path first. It is carried
 * over from `current` — dropping it here is what would silently un-share
 * every folder the next time somebody flipped the runtime mode. */
export function mergeSettings(current: RuntimeSettings, patch: unknown): RuntimeSettings {
  if (!patch || typeof patch !== "object") return current;
  const record = patch as Record<string, unknown>;
  return normalizeSettings({
    mode: record.mode ?? current.mode,
    local: { ...current.local, ...((record.local as Record<string, unknown> | undefined) ?? {}) },
    appearance: {
      ...current.appearance,
      ...((record.appearance as Record<string, unknown> | undefined) ?? {}),
    },
    access: current.access,
  });
}

export class SettingsStore {
  private cached: RuntimeSettings;

  constructor(
    private readonly storage: Storage,
    private readonly policy: SettingsPolicy = defaultSettingsPolicy(),
  ) {
    this.cached = normalizeSettings(this.storage.readJson<unknown>(SETTINGS_FILE, null));
  }

  get(): RuntimeSettings {
    return this.cached;
  }

  set(patch: unknown): RuntimeSettings {
    if (patch && typeof patch === "object") {
      const local = (patch as Record<string, unknown>).local;
      if (local && typeof local === "object") {
        validateLocalPatch(local as Record<string, unknown>, this.policy);
      }
    }
    this.cached = mergeSettings(this.cached, patch);
    this.storage.writeJson(SETTINGS_FILE, this.cached);
    return this.cached;
  }

  /** The only way `access` is written. It arrives already canonicalized by
   * `AccessStore`, and it lands in the same 0600 file as everything else. */
  setAccess(access: AccessSettings): RuntimeSettings {
    this.cached = { ...this.cached, access: normalizeAccess(access) };
    this.storage.writeJson(SETTINGS_FILE, this.cached);
    return this.cached;
  }
}
