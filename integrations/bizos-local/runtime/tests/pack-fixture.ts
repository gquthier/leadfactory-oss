// The sidecar's composition, in miniature — for the tests that need a REAL
// harness behind a pack: the same broker, the same `localTeamTools` shape,
// the same revoke + abort on settle, and the two packs on one `PackHost`.
//
// The CLI is a scripted driver (no model, no network beyond loopback) and
// every state lives under a temporary root the caller removes.
import { join } from "node:path";
import { expect } from "vitest";
import { AgencyService } from "../src/harness/agency.js";
import { fixedClock } from "../src/harness/clock.js";
import type { CodexDynamicTool, CodexTurnHandle, CodexTurnInput } from "../src/harness/codex-driver.js";
import { EcommerceService } from "../src/harness/ecommerce.js";
import { LocalBizosHarness } from "../src/harness/harness.js";
import type { PackHost, PackService } from "../src/harness/pack.js";
import { LocalTeamBroker } from "../src/sidecar.js";

export interface PackFixtureOptions {
  rootDir: string;
  kitRoot?: string;
  fetchImpl?: typeof fetch;
  /** `false` keeps the abort wiring out of the way, so a re-authorisation
   * alone is what refuses a write whose run has ended. */
  abortOnSettle?: boolean;
  /** A stop the scripted CLI does not answer at once, as a real one would not. */
  delayedStop?: boolean;
}

export interface PackFixture {
  harness: LocalBizosHarness;
  broker: LocalTeamBroker;
  /** Every turn the scripted driver was asked to start, in order. */
  turns: CodexTurnInput[];
  agency: AgencyService;
  ecommerce: EcommerceService;
  close(): Promise<void>;
}

/** The harness of the sidecar with both packs attached to it. */
export function buildPacks(options: PackFixtureOptions): PackFixture {
  const rootDir = options.rootDir;
  const scriptedCodexPath = join(rootDir, "scripted-codex");
  const broker = new LocalTeamBroker();
  const turns: CodexTurnInput[] = [];
  let packs: PackService[] = [];
  const startTurn = (input: CodexTurnInput): CodexTurnHandle => {
    expect(input.cli).toBe(scriptedCodexPath);
    turns.push(input);
    return {
      stop: () => options.delayedStop ? undefined : input.onEvent({ type: "turn.completed", ok: false, stopReason: "interrupted" }),
      respond: () => "allowed-once",
      sessionId: () => null,
      settled: () => false,
    };
  };
  const harness = new LocalBizosHarness({
    rootDir,
    homeDir: rootDir,
    baseUrl: "",
    readSessionCookie: async () => "",
    orgName: () => "Local workspace",
    execPath: "/fake/node",
    packaged: false,
    runAsNodeAvailable: false,
    mcpScriptPath: join(rootDir, "disabled-bizos-mcp.mjs"),
    clock: fixedClock(Date.parse("2026-09-09T09:00:00Z")),
    // CLI resolution runs before the injected driver. PATH alone is not
    // isolation: GUI lookup also searches machine installation directories.
    // The existing unpackaged test override names a fake path that only our
    // scripted startTurn consumes; no installed CLI or sign-in is needed.
    environment: { PATH: "/nowhere", LBZ_CODEX_PATH: scriptedCodexPath },
    startTurn,
    devices: false,
    localTeamTools: ({ bot, threadId, runId }) => {
      const session = broker.exchange(broker.issue({ botId: bot.id, threadId, runId }));
      const pack = packs.find((candidate) => candidate.isPackBot(bot.id));
      if (!pack) return [];
      return pack.dynamicTools(() => {
        const capability = broker.authorize(session);
        return { botId: capability.botId, threadId: capability.threadId, runId: capability.runId };
      });
    },
    onLocalRunStopped: (runId) => {
      broker.revoke(runId);
      for (const pack of packs) pack.abortRun(runId);
    },
    onLocalRunSettled: (runId) => {
      broker.revoke(runId);
      if (options.abortOnSettle !== false) for (const pack of packs) pack.abortRun(runId);
    },
  });
  // The packs share this harness: their agents are roster bots the generic
  // installer made, their cockpits run on demand in the bound vault.
  const host = packHostOf(harness);
  const serviceOptions = {
    host,
    ...(options.kitRoot ? { kitRoot: options.kitRoot } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  const agency = new AgencyService(serviceOptions);
  const ecommerce = new EcommerceService(serviceOptions);
  packs = [agency, ecommerce];
  return {
    harness,
    broker,
    turns,
    agency,
    ecommerce,
    close: async () => {
      await Promise.all([agency.close(), ecommerce.close()]);
      harness.stop();
    },
  };
}

/** The host the sidecar hands its packs, verbatim. */
export function packHostOf(harness: LocalBizosHarness): PackHost {
  return {
    rootDir: harness.storage.layout.root,
    binding: () => harness.workspaceTemplate.current(),
    installation: (templateId) => harness.workspaceTemplate.installation(templateId),
    install: (templateId, rootId) => harness.workspaceTemplate.install(templateId, rootId),
    listBots: () => harness.bots.list(),
    run: (runId) => harness.runs.get(runId),
  };
}

export async function json(url: string, init: RequestInit = {}, cookie?: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...(cookie ? { cookie } : {}) },
  });
  const body = await response.json();
  return { status: response.status, body };
}

/** What a person's browser does with the URL `open()` hands out: the ticket
 * in the fragment becomes an HttpOnly session cookie, once. */
export async function dashboardSession(pack: PackService): Promise<{ url: string; ticket: string; cookie: string }> {
  const opened = await pack.open();
  const match = /^(http:\/\/127\.0\.0\.1:\d+)\/#connect=([0-9a-f]{64})$/.exec(opened.dashboardUrl ?? "");
  if (!match) throw new Error(`unexpected open URL: ${opened.dashboardUrl}`);
  const [, url, ticket] = match as unknown as [string, string, string];
  const response = await fetch(`${url}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  if (response.status !== 200) throw new Error(`ticket exchange answered ${response.status}`);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { url, ticket, cookie };
}

export function toolsOf(turn: CodexTurnInput | undefined): Record<string, CodexDynamicTool> {
  return Object.fromEntries((turn?.dynamicTools ?? []).map((tool) => [tool.name, tool]));
}

export async function refused(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal");
}
