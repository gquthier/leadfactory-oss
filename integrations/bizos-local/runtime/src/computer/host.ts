// The Electron primitives the agent's computer is built out of — and the ONLY
// file in this folder that imports Electron.
//
// Everything above it (`native.ts`, `manager.ts`, `broker.ts`) programs against
// the two interfaces declared here, so the whole behaviour of the computer —
// what it refuses, when it sleeps, when it asks — runs under vitest with a fake
// host and no Electron at all. That is the same shape `harness.ts` already has,
// for the same reason.
//
// ── why the agent's browser is OFFSCREEN ────────────────────────────────
//
// `webPreferences.offscreen` renders the page into a bitmap this process owns,
// with no window on any display. Three things follow, and all three are the
// point:
//
//   1. The screen in the panel is the AGENT's screen and cannot be anything
//      else. `capturePage` on an offscreen surface captures that surface.
//      There is no code path here that can reach the user's display: a hidden
//      on-screen window refuses with "Current display surface not available for
//      capture", and this app never asks for `desktopCapturer` at all.
//   2. The agent's browsing never steals focus, never appears in the window
//      list, and cannot be typed into by accident.
//   3. "Take control" is a VIEWER of that surface — frames out, input events in
//      — which is the same lease Rakazo's noVNC gives, and it means the user
//      driving the page is driving THE AGENT'S page, in the agent's partition,
//      rather than a second browser that happens to look like it.
import { session, BrowserWindow, type DownloadItem, type Session } from "electron";
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { MAX_DOWNLOAD_BYTES, SCREEN_HEIGHT, SCREEN_WIDTH, THUMBNAIL_WIDTH } from "./types.js";

/** A frame of the agent's screen. `full` is what the viewer window draws;
 * `thumbnail` is what the panel gets, at a fraction of the bytes. */
export interface CapturedFrame {
  full: string;
  thumbnail: string;
  width: number;
  height: number;
}

export interface DownloadOutcome {
  path: string;
  bytes: number;
  name: string;
}

/** One agent's browser. Nothing here can name another agent's. */
export interface AgentBrowser {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  executeJavaScript(code: string): Promise<unknown>;
  sendInputEvent(event: Record<string, unknown>): void;
  capture(): Promise<CapturedFrame | null>;
  /** Fires when the surface repainted — the viewer's frame clock. */
  onFrame(listener: () => void): void;
  /** Fires when the page became a different page. */
  onNavigated(listener: () => void): void;
  download(url: string): Promise<DownloadOutcome>;
  isDestroyed(): boolean;
  destroy(): void;
}

export interface CreateBrowserInput {
  botId: string;
  /** `persist:agent-<id>` — this agent's cookies, storage and cache, separate
   * from the user's browser AND from every other agent's. */
  partition: string;
  /** `<workspace>/Downloads`. Nothing this browser saves lands anywhere else. */
  downloadDir: string;
}

export interface ComputerHost {
  createBrowser(input: CreateBrowserInput): AgentBrowser;
  /** The hosts this agent's partition holds cookies for — the ones where a
   * click is a click AS THE USER. */
  cookieHosts(partition: string): Promise<string[]>;
}

/** A file name a download is allowed to have on this Mac: no separators, no
 * dot-dot, no leading dot, bounded. `basename` first, then the sieve. */
export function safeDownloadName(raw: string): string {
  const name = basename(String(raw || "download"))
    .replace(/[\u0000-\u001f\u007f/\\]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return name || "download";
}

/**
 * Every permission a page can ask for, answered `no`.
 *
 * A camera, a microphone, a location, a notification, a clipboard read, a USB
 * or serial device: the agent's browser has no use for any of them, and each is
 * a way for a page to reach past the tab. `setPermissionCheckHandler` matters as
 * much as the request handler — some APIs consult the check and never raise a
 * request at all.
 */
export function denyEveryPermission(target: Session): void {
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  target.setPermissionCheckHandler(() => false);
  target.setDevicePermissionHandler(() => false);
  // Electron types this callback's argument as `Response`, which in a lib that
  // also has the DOM resolves to the FETCH Response — so the shape it actually
  // wants (`{cancelled}`) does not typecheck. The cast names what it is rather
  // than dropping the handler: without it, a page can put a system pairing
  // dialog on screen from inside an agent's browser.
  (
    target as unknown as {
      setBluetoothPairingHandler(
        handler: (details: unknown, callback: (response: { cancelled: boolean }) => void) => void,
      ): void;
    }
  ).setBluetoothPairingHandler((_details, callback) => callback({ cancelled: true }));
}

class ElectronAgentBrowser implements AgentBrowser {
  private readonly window: BrowserWindow;
  private readonly downloadDir: string;
  private pendingDownload:
    | { url: string; resolve(value: DownloadOutcome): void; reject(reason: Error): void }
    | null = null;

  constructor(input: CreateBrowserInput, agentSession: Session) {
    this.downloadDir = input.downloadDir;
    try {
      mkdirSync(this.downloadDir, { recursive: true, mode: 0o700 });
    } catch {
      // The spawn below still works; a download will fail with a real reason.
    }
    this.window = new BrowserWindow({
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      show: false,
      webPreferences: {
        offscreen: true,
        partition: input.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        // No preload: the agent's page gets no bridge of any kind. What the
        // agent can do to it, it does through `executeJavaScript` from here.
      },
    });
    // One page at a time, in this surface. A `window.open` becomes a
    // navigation of the same view, so nothing the agent does can produce a
    // second window — visible or otherwise — that no card ever described.
    this.window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void this.window.webContents.loadURL(url).catch(() => undefined);
      return { action: "deny" };
    });
    this.window.webContents.on("will-navigate", (event, url) => {
      if (!/^https?:/i.test(url)) event.preventDefault();
    });
    this.window.webContents.setFrameRate(2);
    this.window.webContents.setBackgroundThrottling(false);
    agentSession.on("will-download", (event, item) => this.confineDownload(event, item));
  }

  /**
   * A download, kept inside the agent's own folder and under the cap.
   *
   * `setSavePath` is what removes the "Save as" sheet AND what decides the
   * destination: without it Chromium would put the file in the user's real
   * Downloads folder, which is the one place a browsing agent must not be able
   * to write. The size is checked twice — the declared total up front, and the
   * running count as it arrives — because `Content-Length` is the server's
   * claim, not a fact.
   */
  private confineDownload(event: { preventDefault(): void }, item: DownloadItem): void {
    const name = safeDownloadName(item.getFilename());
    const target = join(this.downloadDir, name);
    const declared = item.getTotalBytes();
    if (declared > MAX_DOWNLOAD_BYTES) {
      item.cancel();
      this.settleDownload(new Error(`that file is ${Math.round(declared / 1e6)} MB; the limit is 200 MB`));
      return;
    }
    item.setSavePath(target);
    item.on("updated", () => {
      if (item.getReceivedBytes() > MAX_DOWNLOAD_BYTES) item.cancel();
    });
    item.once("done", (_doneEvent, state) => {
      if (state === "completed") {
        this.settleDownload(null, { path: target, bytes: item.getReceivedBytes(), name });
      } else {
        this.settleDownload(new Error(`the download ${state === "cancelled" ? "was cancelled" : "failed"}`));
      }
    });
  }

  private settleDownload(error: Error | null, outcome?: DownloadOutcome): void {
    const pending = this.pendingDownload;
    this.pendingDownload = null;
    if (!pending) return;
    if (error) pending.reject(error);
    else if (outcome) pending.resolve(outcome);
  }

  async loadURL(url: string): Promise<void> {
    await this.window.webContents.loadURL(url);
  }

  getURL(): string {
    return this.window.webContents.getURL();
  }

  getTitle(): string {
    return this.window.webContents.getTitle();
  }

  canGoBack(): boolean {
    return this.window.webContents.navigationHistory.canGoBack();
  }

  canGoForward(): boolean {
    return this.window.webContents.navigationHistory.canGoForward();
  }

  goBack(): void {
    this.window.webContents.navigationHistory.goBack();
  }

  goForward(): void {
    this.window.webContents.navigationHistory.goForward();
  }

  reload(): void {
    this.window.webContents.reload();
  }

  async executeJavaScript(code: string): Promise<unknown> {
    return this.window.webContents.executeJavaScript(code, true);
  }

  sendInputEvent(event: Record<string, unknown>): void {
    this.window.webContents.sendInputEvent(event as never);
  }

  /**
   * A frame, in the SAME coordinate space the agent is told to click in.
   *
   * `capturePage` answers device pixels — 2560x1600 on a Retina Mac — while
   * every coordinate in an observation comes from `getBoundingClientRect()`,
   * which is CSS pixels. Reporting the bitmap's size handed the model a screen
   * twice as big as the one it was clicking on: a link at (297, 207) was
   * described as being on a 2560-wide screen, and a coordinate click computed
   * from that landed nowhere. So the frame is resized to the surface's own
   * width and reported as that.
   */
  async capture(): Promise<CapturedFrame | null> {
    try {
      const image = await this.window.webContents.capturePage();
      if (image.isEmpty()) return null;
      const scaled = image.getSize().width === SCREEN_WIDTH ? image : image.resize({ width: SCREEN_WIDTH });
      const size = scaled.getSize();
      return {
        full: `data:image/jpeg;base64,${scaled.toJPEG(72).toString("base64")}`,
        thumbnail: `data:image/jpeg;base64,${scaled.resize({ width: THUMBNAIL_WIDTH }).toJPEG(66).toString("base64")}`,
        width: size.width,
        height: size.height,
      };
    } catch {
      return null;
    }
  }

  onFrame(listener: () => void): void {
    this.window.webContents.on("paint", () => listener());
  }

  onNavigated(listener: () => void): void {
    this.window.webContents.on("did-navigate", () => listener());
    this.window.webContents.on("did-navigate-in-page", () => listener());
    this.window.webContents.on("page-title-updated", () => listener());
  }

  async download(url: string): Promise<DownloadOutcome> {
    if (this.pendingDownload) throw new Error("this computer is already downloading something");
    return new Promise<DownloadOutcome>((resolve, reject) => {
      this.pendingDownload = { url, resolve, reject };
      const timer = setTimeout(() => this.settleDownload(new Error("the download timed out")), 120_000);
      timer.unref?.();
      this.window.webContents.downloadURL(url);
    });
  }

  isDestroyed(): boolean {
    return this.window.isDestroyed();
  }

  destroy(): void {
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}

/** The real host. Built once in `application.ts` and handed to the harness. */
export function createElectronComputerHost(): ComputerHost {
  return {
    createBrowser(input) {
      const agentSession = session.fromPartition(input.partition, { cache: true });
      denyEveryPermission(agentSession);
      return new ElectronAgentBrowser(input, agentSession);
    },
    async cookieHosts(partition) {
      try {
        const cookies = await session.fromPartition(partition, { cache: true }).cookies.get({});
        const hosts = new Set<string>();
        for (const cookie of cookies) {
          const domain = (cookie.domain ?? "").replace(/^\./, "").toLowerCase();
          if (domain) hosts.add(domain);
        }
        return [...hosts];
      } catch {
        return [];
      }
    },
  };
}
