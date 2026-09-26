// The small program that runs ON the cloud computer and drives one agent's
// screen there.
//
// One Boat sandbox is shared by every agent of the workspace, so what keeps
// two agents from clicking in each other's browser is not a VM each but a
// SEAT each, made of three things only that agent's id can name:
//
//   * its own X display (`Xvfb :10`, `:11`, …) — allocated once, recorded in
//     `/home/user/bizos/agents/<slug>/computer.json`, and reserved by an
//     atomic `mkdir` under `/home/user/bizos/computer/slots/<n>`;
//   * its own Chrome, on that display, with its own profile
//     (`/home/user/bizos/agents/<slug>/chrome`, on the snapshotted disk, so the
//     cookies survive a sleep) and its own DevTools port (`9300 + n`, bound to
//     127.0.0.1 of the sandbox);
//   * its own screenshots, taken over that Chrome's DevTools connection.
//
// The runtime uploads this file once (its name carries a hash of its content,
// so a new version is a new file) and then runs, per tool call,
//
//   node /home/user/bizos/computer-helper-<hash>.mjs '<base64 JSON request>'
//
// which makes sure the seat is up, runs the action batch over CDP, and prints
// ONE line: `__BIZOS_COMPUTER__{json}` — the page, what is on it, and a JPEG
// of that agent's screen.
//
// The same file is also the CONTROL DAEMON (`--daemon`): a small HTTP +
// WebSocket server on `CONTROL_PORT`, started detached by the `control` op
// and reached by the desktop app through a Boat-hosted route. One WebSocket
// is one person driving one seat: the daemon streams that seat's screen
// (`Page.startScreencast`, JPEG frames) and dispatches the person's mouse
// and keyboard over the same DevTools connection the agent uses. The route
// is public on Boat's side; the daemon checks a per-session secret the
// runtime wrote to `control.json` (0600) and refuses everything else. The page-side scripts (the probe, the selector
// click, the typing) are the SAME strings the native backend injects
// (`observe.ts`): the runtime builds them and ships them in the request, so
// the two backends cannot drift.
import { createHash } from "node:crypto";
import { clickSelectorScript, pageProbeScript, scrollScript, typeIntoScript } from "./observe.js";
import { MAX_DOWNLOAD_BYTES, MAX_SETTLE_MS, SCREEN_HEIGHT, SCREEN_WIDTH, THUMBNAIL_WIDTH, type ComputerAction } from "./types.js";

export const HELPER_MARKER = "__BIZOS_COMPUTER__";
export const HELPER_MISSING = "__BIZOS_COMPUTER_HELPER_MISSING__";
export const HELPER_DIR = "/home/user/bizos";
/** First X display handed to an agent; `:0` is Boat's own desktop. */
export const FIRST_DISPLAY = 10;
export const LAST_DISPLAY = 89;
/** DevTools port of display `n` is `PORT_BASE + n`. */
export const PORT_BASE = 9300;
/** The control daemon's port on the sandbox (bound 0.0.0.0 for Boat's route). */
export const CONTROL_PORT = 9399;
/** Screencast frames go through Boat's HTTPS route: keep them small. */
export const CONTROL_JPEG_QUALITY = 50;

/** An action as the helper runs it: page scripts are already built. */
export type HelperAction =
  | { kind: "navigate"; url: string }
  | { kind: "pointer"; x: number; y: number; type: "move" | "down" | "up" | "click"; button: "left" | "right" }
  | { kind: "eval"; script: string; settle?: boolean }
  | { kind: "insertText"; text: string }
  | { kind: "key"; key: string; modifiers: string[] }
  | { kind: "wait"; ms: number };

export type HelperRequest =
  | { op: "observe"; agent: string; frame?: boolean }
  | { op: "act"; agent: string; actions: HelperAction[]; observe: boolean; settleMs: number }
  | { op: "cookies"; agent: string }
  | { op: "download"; agent: string; url: string }
  /** Make sure the control daemon runs and knows this session's secret. */
  | { op: "control"; agent: string; secret: string }
  | { op: "shutdown" };

export interface HelperProbe {
  url?: unknown;
  title?: unknown;
  text?: unknown;
  elements?: unknown;
}

/** What one helper run printed after the marker. Every field is re-checked by
 * the backend: it came back from a machine agents run code on. */
export interface HelperResponse {
  ok: boolean;
  error?: string;
  completed?: number;
  display?: string;
  port?: number;
  profile?: string;
  browserPid?: number;
  url?: string;
  title?: string;
  probe?: HelperProbe;
  width?: number;
  height?: number;
  /** base64 JPEG of the agent's screen at its own size. */
  image?: string;
  /** base64 JPEG, `THUMBNAIL_WIDTH` wide, for the panel. */
  thumb?: string;
  cookieHosts?: string[];
  download?: { path: string; bytes: number; name: string };
  closed?: string[];
  /** Answer of `control`: where the daemon listens on the sandbox. */
  control?: { port: number };
}

/** A `ComputerAction` as a `HelperAction`: the page scripts are built HERE,
 * from the same builders the native backend uses. */
export function toHelperActions(actions: readonly ComputerAction[]): HelperAction[] {
  return actions.map((action): HelperAction => {
    switch (action.kind) {
      case "navigate":
        return { kind: "navigate", url: action.url };
      case "pointer":
        return { kind: "pointer", x: action.x, y: action.y, type: action.type, button: action.button };
      case "clickSelector":
        return { kind: "eval", script: clickSelectorScript(action.selector), settle: true };
      case "type":
        return action.selector
          ? { kind: "eval", script: typeIntoScript(action.selector, action.text) }
          : { kind: "insertText", text: action.text };
      case "key":
        return { kind: "key", key: action.key, modifiers: action.modifiers };
      case "scroll":
        return { kind: "eval", script: scrollScript(action.direction, action.amount) };
      case "wait":
        return { kind: "wait", ms: action.ms };
    }
  });
}

/** The helper's source. Plain ESM for the sandbox's Node (24, with a global
 * WebSocket and fetch); no dependency, no template literal inside it. */
export function computerHelperSource(): string {
  const constants = [
    `const MARK = ${JSON.stringify(HELPER_MARKER)};`,
    `const ROOT = ${JSON.stringify(HELPER_DIR)};`,
    `const FIRST = ${FIRST_DISPLAY}, LAST = ${LAST_DISPLAY}, PORT_BASE = ${PORT_BASE};`,
    `const W = ${SCREEN_WIDTH}, H = ${SCREEN_HEIGHT}, THUMB_W = ${THUMBNAIL_WIDTH};`,
    `const CONTROL_PORT = ${CONTROL_PORT}, CONTROL_QUALITY = ${CONTROL_JPEG_QUALITY};`,
    `const MAX_SETTLE = ${MAX_SETTLE_MS}, MAX_DOWNLOAD = ${MAX_DOWNLOAD_BYTES};`,
    `const PROBE = ${JSON.stringify(pageProbeScript())};`,
  ].join("\n");
  return `${HELPER_HEADER}\n${constants}\n${HELPER_BODY}`;
}

export function helperVersion(source = computerHelperSource()): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

export function helperPath(version = helperVersion()): string {
  return `${HELPER_DIR}/computer-helper-${version}.mjs`;
}

/** The shell line that runs one request, or says the helper is missing. */
export function helperCommand(request: HelperRequest, path = helperPath()): string {
  const payload = Buffer.from(JSON.stringify(request), "utf8").toString("base64");
  return `H=${path}; [ -f "$H" ] || { echo ${HELPER_MISSING}; exit 0; }; exec node "$H" '${payload}'`;
}

/** The last marker line of a helper run, parsed; `null` when there is none. */
export function parseHelperOutput(stdout: string): HelperResponse | null {
  const at = stdout.lastIndexOf(HELPER_MARKER);
  if (at === -1) return null;
  const line = stdout.slice(at + HELPER_MARKER.length).split("\n", 1)[0] ?? "";
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as HelperResponse;
  } catch {
    return null;
  }
}

const HELPER_HEADER = `// Local BizOS — one agent's seat on the shared cloud computer. Generated; do not edit.
import { spawn, execFileSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, createWriteStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";`;

const HELPER_BODY = String.raw`
const AGENTS = ROOT + "/agents";
const SLOTS = ROOT + "/computer/slots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The answer is printed once, at the end, and the process exits only after the
// pipe took all of it: a screenshot is larger than a pipe buffer, and an exit
// right after a write would cut it.
let answer = null;
const out = (value) => { answer = value; };
const finish = () => process.stdout.write(MARK + JSON.stringify(answer || { ok: false, error: "no answer" }) + "\n", () => process.exit(0));

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function pgrep(pattern) {
  try { return execFileSync("pgrep", ["-f", "--", pattern], { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean).map(Number); }
  catch { return []; }
}
function which(bin) {
  try { execFileSync("sh", ["-c", "command -v " + bin], { stdio: "ignore" }); return true; } catch { return false; }
}
function safeSlug(value) {
  const slug = String(value || "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("no agent");
  return slug;
}

// ── the seat: display, port, profile ────────────────────────────────────
function seatFor(slug) {
  const dir = AGENTS + "/" + slug;
  mkdirSync(dir, { recursive: true });
  mkdirSync(SLOTS, { recursive: true });
  const record = dir + "/computer.json";
  try {
    const saved = JSON.parse(readFileSync(record, "utf8"));
    if (Number.isInteger(saved.display) && readFileSync(SLOTS + "/" + saved.display + "/owner", "utf8") === slug) {
      return { dir, display: saved.display, port: PORT_BASE + saved.display, profile: dir + "/chrome" };
    }
  } catch {}
  for (let n = FIRST; n <= LAST; n += 1) {
    try { mkdirSync(SLOTS + "/" + n); } catch { continue; }
    writeFileSync(SLOTS + "/" + n + "/owner", slug);
    writeFileSync(record, JSON.stringify({ display: n, port: PORT_BASE + n }));
    return { dir, display: n, port: PORT_BASE + n, profile: dir + "/chrome" };
  }
  throw new Error("every screen of the cloud computer is taken");
}

/** The seat an agent already has, or null: the daemon never allocates. */
function seatIfAny(slug) {
  const dir = AGENTS + "/" + slug;
  try {
    const saved = JSON.parse(readFileSync(dir + "/computer.json", "utf8"));
    if (Number.isInteger(saved.display) && readFileSync(SLOTS + "/" + saved.display + "/owner", "utf8") === slug) {
      return { dir, display: saved.display, port: PORT_BASE + saved.display, profile: dir + "/chrome" };
    }
  } catch {}
  return null;
}

function installXvfb() {
  const lock = ROOT + "/computer/apt.lock";
  try { mkdirSync(lock); } catch {
    // Another agent is installing it: wait for it rather than race apt.
    for (let i = 0; i < 240 && !which("Xvfb"); i += 1) execFileSync("sleep", ["0.5"]);
    return;
  }
  try {
    try { execFileSync("sudo", ["-n", "apt-get", "install", "-y", "-q", "xvfb"], { stdio: "ignore", timeout: 150000 }); }
    catch {
      execFileSync("sudo", ["-n", "apt-get", "update", "-q"], { stdio: "ignore", timeout: 150000 });
      execFileSync("sudo", ["-n", "apt-get", "install", "-y", "-q", "xvfb"], { stdio: "ignore", timeout: 150000 });
    }
  } catch {} finally { rmSync(lock, { recursive: true, force: true }); }
}

async function ensureDisplay(n) {
  const socket = "/tmp/.X11-unix/X" + n;
  if (existsSync(socket) && pgrep("Xvfb :" + n + " ").length) return ":" + n;
  const lock = "/tmp/.X" + n + "-lock";
  if (existsSync(lock)) {
    let pid = 0;
    try { pid = Number(readFileSync(lock, "utf8").trim()); } catch {}
    if (!pid || !alive(pid)) { rmSync(lock, { force: true }); rmSync(socket, { force: true }); }
  }
  if (!which("Xvfb")) installXvfb();
  if (!which("Xvfb")) return null;
  const child = spawn("Xvfb", [":" + n, "-screen", "0", W + "x" + H + "x24", "-nolisten", "tcp", "-ac"], { detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 60; i += 1) { if (existsSync(socket)) return ":" + n; await sleep(100); }
  return null;
}

async function devtools(port) {
  try {
    const response = await fetch("http://127.0.0.1:" + port + "/json/version", { signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

function clearProfileLocks(profile) {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) rmSync(profile + "/" + name, { force: true });
}

/**
 * Chrome normally discards session cookies when a cleanly closed profile is
 * next opened on a blank page. "Continue where you left off" is the browser's
 * own durable-session contract: Chromium names this preference
 * session.restore_on_startup, with value 1 for restore-last-session.
 *
 * Set only that preference, inside this agent's Default profile. We never
 * rewrite cookies or turn them into persistent cookies, and a malformed
 * Preferences file is left untouched rather than replaced.
 */
function keepBrowserSession(profile) {
  const dir = profile + "/Default";
  const file = dir + "/Preferences";
  mkdirSync(dir, { recursive: true });
  let preferences = {};
  if (existsSync(file)) {
    preferences = JSON.parse(readFileSync(file, "utf8"));
    if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) throw new Error("Chrome Preferences is not an object");
  }
  const current = preferences.session;
  const session = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  if (session.restore_on_startup === 1) return;
  preferences.session = { ...session, restore_on_startup: 1 };
  const temporary = file + ".bizos-" + process.pid;
  writeFileSync(temporary, JSON.stringify(preferences), { mode: 0o600 });
  renameSync(temporary, file);
}

async function ensureChrome(seat) {
  if (await devtools(seat.port)) return { display: seat.displayName };
  mkdirSync(seat.profile, { recursive: true });
  // A Chrome that holds this profile but does not answer is a stuck one; a
  // lock with no Chrome behind it is a leftover of the last snapshot.
  for (const pid of pgrep("--user-data-dir=" + seat.profile)) { try { process.kill(pid, "SIGKILL"); } catch {} }
  await sleep(200);
  clearProfileLocks(seat.profile);
  keepBrowserSession(seat.profile);
  const args = [
    "--user-data-dir=" + seat.profile,
    "--restore-last-session",
    "--remote-debugging-port=" + seat.port,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run", "--no-default-browser-check", "--disable-default-apps",
    "--password-store=basic", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-features=Translate,MediaRouter,ChromeWhatsNewUI",
    "--disable-session-crashed-bubble", "--hide-crash-restore-bubble", "--noerrdialogs",
    "--force-device-scale-factor=1", "--window-position=0,0", "--window-size=" + W + "," + H,
  ];
  if (seat.displayName === "headless") args.push("--headless=new"); else args.push("--kiosk");
  for (const sandboxed of [true, false]) {
    const child = spawn("google-chrome-stable", [...args, ...(sandboxed ? [] : ["--no-sandbox"]), "about:blank"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, DISPLAY: seat.displayName === "headless" ? "" : seat.displayName },
    });
    child.unref();
    let exited = false;
    child.once("exit", () => { exited = true; });
    for (let i = 0; i < 80 && !exited; i += 1) {
      if (await devtools(seat.port)) return { display: seat.displayName };
      await sleep(150);
    }
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    await sleep(200);
    clearProfileLocks(seat.profile);
  }
  throw new Error("Chrome did not start on the cloud computer");
}

// ── a DevTools connection ─────────────────────────────────────────────
class Cdp {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.waiters = []; this.handlers = new Map(); this.onClose = null; }
  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error("DevTools did not answer")), 8000);
      ws.onopen = () => { clearTimeout(timer); resolve(this); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("DevTools connection failed")); };
      ws.onclose = () => { if (this.onClose) this.onClose(); };
      ws.onmessage = (event) => {
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.id && this.pending.has(message.id)) {
          const entry = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) entry.reject(new Error(message.error.message || "DevTools error"));
          else entry.resolve(message.result || {});
          return;
        }
        if (message.method) {
          for (const handler of this.handlers.get(message.method) || []) { try { handler(message.params || {}); } catch {} }
          for (const waiter of [...this.waiters]) {
            if (waiter.method === message.method) { this.waiters.splice(this.waiters.indexOf(waiter), 1); waiter.resolve(message.params || {}); }
          }
        }
      };
    });
  }
  send(method, params, timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + " timed out")); }, timeoutMs || 30000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  waitFor(method, timeoutMs) {
    return new Promise((resolve) => {
      const waiter = { method, resolve };
      this.waiters.push(waiter);
      setTimeout(() => { const at = this.waiters.indexOf(waiter); if (at !== -1) this.waiters.splice(at, 1); resolve(null); }, timeoutMs);
    });
  }
  on(method, handler) { const list = this.handlers.get(method) || []; list.push(handler); this.handlers.set(method, list); }
  close() { try { this.ws.close(); } catch {} }
}

async function pages(port) {
  const response = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(3000) });
  return (await response.json()).filter((target) => target.type === "page");
}

async function mainPage(port) {
  let list = await pages(port);
  if (!list.length) {
    await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", { method: "PUT", signal: AbortSignal.timeout(3000) });
    list = await pages(port);
  }
  // The oldest page is the agent's screen; /json/list answers newest first.
  const page = list[list.length - 1];
  if (!page) throw new Error("the agent's browser has no page");
  return page;
}

/** One page at a time: whatever a click opened in a new tab becomes a
 * navigation of the agent's own page, and the extra tab is closed. */
async function foldPopups(port, cdp, keepId) {
  const list = await pages(port).catch(() => []);
  let last = "";
  for (const target of list) {
    if (target.id === keepId) continue;
    if (/^https?:/i.test(target.url || "")) last = target.url;
    await fetch("http://127.0.0.1:" + port + "/json/close/" + target.id, { signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  }
  if (last) await navigate(cdp, last);
}

async function settle(cdp, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const state = await cdp.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, 3000);
      if (state.result && state.result.value === "complete") return;
    } catch {}
    await sleep(150);
  }
}

async function navigate(cdp, url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("that address is not one a computer may open");
  const loaded = cdp.waitFor("Page.loadEventFired", MAX_SETTLE);
  const result = await cdp.send("Page.navigate", { url }, MAX_SETTLE + 5000);
  if (result.errorText) throw new Error("could not open " + url + " (" + result.errorText + ")");
  await loaded;
  await settle(cdp, 1500);
}

const KEYS = {
  enter: ["Enter", "Enter", 13, "\r"], return: ["Enter", "Enter", 13, "\r"], tab: ["Tab", "Tab", 9],
  backspace: ["Backspace", "Backspace", 8], escape: ["Escape", "Escape", 27], esc: ["Escape", "Escape", 27],
  delete: ["Delete", "Delete", 46], space: [" ", "Space", 32, " "], home: ["Home", "Home", 36], end: ["End", "End", 35],
  pageup: ["PageUp", "PageUp", 33], pagedown: ["PageDown", "PageDown", 34],
  arrowup: ["ArrowUp", "ArrowUp", 38], up: ["ArrowUp", "ArrowUp", 38], arrowdown: ["ArrowDown", "ArrowDown", 40], down: ["ArrowDown", "ArrowDown", 40],
  arrowleft: ["ArrowLeft", "ArrowLeft", 37], left: ["ArrowLeft", "ArrowLeft", 37], arrowright: ["ArrowRight", "ArrowRight", 39], right: ["ArrowRight", "ArrowRight", 39],
};
const MODIFIER_BITS = { alt: 1, control: 2, meta: 4, shift: 8 };

async function pressKey(cdp, name, modifiers) {
  let mask = 0;
  for (const modifier of modifiers || []) mask |= MODIFIER_BITS[modifier] || 0;
  const named = KEYS[String(name).toLowerCase()];
  let key, code, vk, text;
  if (named) { [key, code, vk, text] = named; }
  else if (/^[A-Za-z0-9]$/.test(name)) {
    key = (mask & 8) ? name.toUpperCase() : name;
    code = /[0-9]/.test(name) ? "Digit" + name : "Key" + name.toUpperCase();
    vk = name.toUpperCase().charCodeAt(0);
    text = key;
  } else if (/^F([1-9]|1[0-2])$/i.test(name)) {
    key = name.toUpperCase(); code = key; vk = 111 + Number(key.slice(1));
  } else throw new Error("unknown key " + name);
  if (mask & 6) text = undefined; // a shortcut types nothing
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mask };
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: text ? "keyDown" : "rawKeyDown", ...(text ? { text, unmodifiedText: text } : {}) });
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

async function pointer(cdp, action) {
  const base = { x: action.x, y: action.y, button: action.button === "right" ? "right" : "left", clickCount: 1 };
  if (action.type === "move") return cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: action.x, y: action.y });
  if (action.type === "down") return cdp.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
  if (action.type === "up") return cdp.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: action.x, y: action.y });
  await cdp.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
  await cdp.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
}

async function run(cdp, action) {
  switch (action.kind) {
    case "navigate": return navigate(cdp, String(action.url));
    case "pointer": {
      await pointer(cdp, action);
      if (action.type === "click" || action.type === "up") { await sleep(250); await settle(cdp, 5000); }
      return;
    }
    case "eval": {
      const result = await cdp.send("Runtime.evaluate", { expression: String(action.script), returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error("the page refused that action");
      const value = result.result ? result.result.value : undefined;
      if (value && value.ok === false) throw new Error(value.reason || "that action did not land on anything");
      if (action.settle) { await sleep(250); await settle(cdp, 5000); }
      return;
    }
    case "insertText": return cdp.send("Input.insertText", { text: String(action.text) });
    case "key": {
      await pressKey(cdp, String(action.key), action.modifiers);
      await sleep(150);
      await settle(cdp, 5000);
      return;
    }
    case "wait": return sleep(Math.max(0, Math.min(5000, Number(action.ms) || 0)));
    default: throw new Error("unsupported action");
  }
}

async function cookieHosts(cdp) {
  let cookies = [];
  try { cookies = (await cdp.send("Storage.getCookies", {})).cookies || []; }
  catch { try { cookies = (await cdp.send("Network.getAllCookies", {})).cookies || []; } catch {} }
  const hosts = new Set();
  for (const cookie of cookies) {
    const domain = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
    if (domain) hosts.add(domain);
  }
  return [...hosts];
}

async function look(cdp, withImage) {
  const probeResult = await cdp.send("Runtime.evaluate", { expression: PROBE, returnByValue: true }).catch(() => ({}));
  const probe = (probeResult.result && probeResult.result.value) || {};
  const metrics = await cdp.send("Page.getLayoutMetrics", {}).catch(() => ({}));
  const view = metrics.cssVisualViewport || metrics.visualViewport || {};
  const width = Math.round(view.clientWidth || W);
  const height = Math.round(view.clientHeight || H);
  const frame = { probe, url: String(probe.url || ""), title: String(probe.title || ""), width, height };
  if (!withImage) return frame;
  const image = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 72 }).catch(() => ({}));
  const thumb = await cdp.send("Page.captureScreenshot", {
    format: "jpeg", quality: 66,
    clip: { x: view.pageX || 0, y: view.pageY || 0, width, height, scale: THUMB_W / width },
  }).catch(() => ({}));
  return { ...frame, image: image.data || "", thumb: thumb.data || "" };
}

function safeName(raw) {
  const name = basename(String(raw || "download")).replace(/[\u0000-\u001f\u007f/\\]/g, "").replace(/^\.+/, "").trim().slice(0, 120);
  return name || "download";
}

async function download(cdp, dir, url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("a computer can only download from an http(s) address");
  const cookies = (await cdp.send("Network.getCookies", { urls: [url] }).catch(() => ({}))).cookies || [];
  const agent = (await cdp.send("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true }).catch(() => ({}))).result;
  const response = await fetch(url, {
    headers: {
      ...(cookies.length ? { cookie: cookies.map((c) => c.name + "=" + c.value).join("; ") } : {}),
      ...(agent && agent.value ? { "user-agent": String(agent.value) } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok || !response.body) throw new Error("the download failed (HTTP " + response.status + ")");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_DOWNLOAD) throw new Error("that file is " + Math.round(declared / 1e6) + " MB; the limit is 200 MB");
  const disposition = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(response.headers.get("content-disposition") || "");
  const name = safeName(disposition ? decodeURIComponent(disposition[1]) : new URL(response.url || url).pathname.split("/").pop());
  mkdirSync(dir + "/Downloads", { recursive: true });
  const path = dir + "/Downloads/" + name;
  const file = createWriteStream(path);
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_DOWNLOAD) { file.destroy(); rmSync(path, { force: true }); throw new Error("that file is over the 200 MB limit"); }
    if (!file.write(chunk)) await new Promise((r) => file.once("drain", r));
  }
  await new Promise((r) => file.end(r));
  return { path, bytes: statSync(path).size, name };
}

/** Close every agent's Chrome cleanly, so its cookies are on disk before the
 * machine is snapshotted. A killed Chrome can lose the last ~30 s of them. */
async function shutdown() {
  const closed = [];
  for (let n = FIRST; n <= LAST; n += 1) {
    const version = await devtools(PORT_BASE + n);
    if (!version || !version.webSocketDebuggerUrl) continue;
    try {
      const cdp = await new Cdp(version.webSocketDebuggerUrl).open();
      await cdp.send("Browser.close", {}, 5000).catch(() => undefined);
      cdp.close();
    } catch {}
    for (let i = 0; i < 40 && (await devtools(PORT_BASE + n)); i += 1) await sleep(100);
    closed.push(":" + n);
  }
  await sleep(500);
  return closed;
}

// ── the control daemon: a person's live seat ──────────────────────────
const CONTROL_FILE = ROOT + "/computer/control.json";
const MODIFIER_NAMES = { shift: 8, control: 2, alt: 1, meta: 4 };
// The person's keyboard, as the viewer names keys (DOM KeyboardEvent.key):
// key, code, virtual key, and the text a keyDown types by itself.
const NAMED_KEYS = {
  Enter: ["Enter", "Enter", 13, "\r"], Backspace: ["Backspace", "Backspace", 8], Tab: ["Tab", "Tab", 9, "\t"],
  Delete: ["Delete", "Delete", 46], Escape: ["Escape", "Escape", 27], Home: ["Home", "Home", 36], End: ["End", "End", 35],
  PageUp: ["PageUp", "PageUp", 33], PageDown: ["PageDown", "PageDown", 34], Insert: ["Insert", "Insert", 45],
  ArrowUp: ["ArrowUp", "ArrowUp", 38], ArrowDown: ["ArrowDown", "ArrowDown", 40], ArrowLeft: ["ArrowLeft", "ArrowLeft", 37], ArrowRight: ["ArrowRight", "ArrowRight", 39],
  Shift: ["Shift", "ShiftLeft", 16], Control: ["Control", "ControlLeft", 17], Alt: ["Alt", "AltLeft", 18], Meta: ["Meta", "MetaLeft", 91], CapsLock: ["CapsLock", "CapsLock", 20],
};

function readControl() {
  try { return JSON.parse(readFileSync(CONTROL_FILE, "utf8")); } catch { return null; }
}

function writeControl(secret) {
  mkdirSync(ROOT + "/computer", { recursive: true });
  writeFileSync(CONTROL_FILE, JSON.stringify({ secret, at: Date.now() }), { mode: 0o600 });
}

function secretMatches(given) {
  const control = readControl();
  if (!control || typeof control.secret !== "string" || typeof given !== "string" || !given) return false;
  const a = createHash("sha256").update(control.secret).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

async function daemonHealth() {
  try {
    const response = await fetch("http://127.0.0.1:" + CONTROL_PORT + "/health", { signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

/** The daemon of THIS helper version is up. An older one is replaced. */
async function ensureDaemon() {
  const me = process.argv[1];
  const health = await daemonHealth();
  if (health && health.path === me) return;
  for (const pid of pgrep("computer-helper-[a-f0-9]+\\.mjs --daemon")) { if (pid !== process.pid) { try { process.kill(pid, "SIGKILL"); } catch {} } }
  await sleep(300);
  const child = spawn(process.execPath, [me, "--daemon"], { detached: true, stdio: "ignore", env: { ...process.env } });
  child.unref();
  for (let i = 0; i < 50; i += 1) {
    const now = await daemonHealth();
    if (now && now.path === me) return;
    await sleep(100);
  }
  throw new Error("the control daemon did not start on the cloud computer");
}

// A WebSocket server in eighty lines (RFC 6455, server side, no extensions):
// the sandbox's Node has a WebSocket client and no server.
function acceptWebSocket(request, socket, head) {
  const key = request.headers["sec-websocket-key"];
  if (!key || String(request.headers.upgrade || "").toLowerCase() !== "websocket") { socket.destroy(); return null; }
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  socket.setNoDelay(true);
  let buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
  let fragments = [];
  let fragmentOp = 0;
  const ws = {
    socket,
    onmessage: null,
    onclose: null,
    closed: false,
    frame(op, payload) {
      if (socket.destroyed || ws.closed) return;
      const length = payload.length;
      let header;
      if (length < 126) header = Buffer.from([0x80 | op, length]);
      else if (length < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(length, 2); }
      else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
      socket.write(Buffer.concat([header, payload]));
    },
    sendText(value) { ws.frame(1, Buffer.from(String(value), "utf8")); },
    sendBinary(payload) { ws.frame(2, payload); },
    /** Bytes queued and not yet on the wire — a slow route skips frames. */
    backlog() { return socket.writableLength; },
    close() { if (ws.closed) return; ws.closed = true; try { ws.frame(8, Buffer.alloc(0)); } catch {} socket.end(); },
  };
  const finish = () => { if (ws.closed) return; ws.closed = true; if (ws.onclose) ws.onclose(); };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const op = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      let payload = buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = buffer.subarray(offset - 4, offset);
        const clear = Buffer.alloc(length);
        for (let i = 0; i < length; i += 1) clear[i] = payload[i] ^ mask[i & 3];
        payload = clear;
      }
      buffer = buffer.subarray(offset + length);
      if (op === 8) { ws.close(); finish(); return; }
      if (op === 9) { ws.frame(10, payload); continue; }
      if (op === 10) continue;
      if (op === 0) { fragments.push(payload); if (!fin) continue; payload = Buffer.concat(fragments); fragments = []; }
      else if (!fin) { fragmentOp = op; fragments = [payload]; continue; }
      const kind = op === 0 ? fragmentOp : op;
      if (ws.onmessage) { try { ws.onmessage(kind === 1 ? payload.toString("utf8") : payload); } catch {} }
    }
  });
  socket.on("close", finish);
  socket.on("error", finish);
  return ws;
}

function modifierMask(list) {
  let mask = 0;
  // A Mac's Cmd is the sandbox's Ctrl: Cmd+A selects all there too.
  for (const name of Array.isArray(list) ? list : []) mask |= name === "meta" ? MODIFIER_NAMES.control : (MODIFIER_NAMES[name] || 0);
  return mask;
}

function keyDescriptor(name) {
  const named = NAMED_KEYS[name];
  if (named) return { key: named[0], code: named[1], vk: named[2], text: named[3] };
  if (typeof name === "string" && name.length === 1) {
    const upper = name.toUpperCase();
    const letter = /^[A-Z]$/.test(upper);
    const digit = /^[0-9]$/.test(name);
    return { key: name, code: letter ? "Key" + upper : digit ? "Digit" + name : name === " " ? "Space" : "", vk: letter || digit ? upper.charCodeAt(0) : name === " " ? 32 : 0, text: name };
  }
  if (/^F([1-9]|1[0-2])$/.test(String(name))) return { key: name, code: name, vk: 111 + Number(String(name).slice(1)) };
  return null;
}

/** One event from the viewer, as the seat's Chrome receives it. */
async function dispatchInput(cdp, event, state) {
  const type = String(event.type || "");
  const modifiers = modifierMask(event.modifiers);
  if (type === "mouseMove" || type === "mouseDown" || type === "mouseUp") {
    const x = Math.max(0, Math.round(Number(event.x) || 0));
    const y = Math.max(0, Math.round(Number(event.y) || 0));
    const button = event.button === "right" ? "right" : event.button === "middle" ? "middle" : "left";
    if (type === "mouseMove") return cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers, button: state.pressed ? button : "none" }, 5000);
    if (type === "mouseDown") {
      const now = Date.now();
      const near = state.lastDown && now - state.lastDown.at < 450 && Math.abs(state.lastDown.x - x) < 5 && Math.abs(state.lastDown.y - y) < 5;
      state.clickCount = near ? Math.min(3, state.lastDown.count + 1) : 1;
      state.lastDown = { at: now, x, y, count: state.clickCount };
      state.pressed = true;
      return cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: state.clickCount, modifiers }, 5000);
    }
    state.pressed = false;
    return cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: state.clickCount || 1, modifiers }, 5000);
  }
  if (type === "mouseWheel") {
    // The viewer sends deltas the Electron way (up is positive); DevTools
    // scrolls down for a positive delta.
    return cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: Math.round(Number(event.x) || 0), y: Math.round(Number(event.y) || 0), modifiers,
      deltaX: -(Number(event.deltaX) || 0), deltaY: -(Number(event.deltaY) || 0),
    }, 5000);
  }
  if (type === "char") {
    if (modifiers & (MODIFIER_NAMES.control | MODIFIER_NAMES.alt)) return;
    const text = String(event.keyCode || "");
    if (text.length === 1) return cdp.send("Input.insertText", { text }, 5000);
    return;
  }
  if (type === "keyDown" || type === "keyUp") {
    const descriptor = keyDescriptor(String(event.keyCode || ""));
    if (!descriptor) return;
    const shortcut = (modifiers & (MODIFIER_NAMES.control | MODIFIER_NAMES.alt)) !== 0;
    // A printable key without Ctrl/Alt is typed by its char event.
    if (type === "keyDown" && descriptor.text && descriptor.text.length === 1 && !shortcut && descriptor.key !== "Enter") return;
    const base = { key: descriptor.key, code: descriptor.code, windowsVirtualKeyCode: descriptor.vk, nativeVirtualKeyCode: descriptor.vk, modifiers };
    if (type === "keyUp") return cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" }, 5000);
    const text = shortcut ? undefined : descriptor.text;
    return cdp.send("Input.dispatchKeyEvent", { ...base, type: text ? "keyDown" : "rawKeyDown", ...(text ? { text, unmodifiedText: text } : {}) }, 5000);
  }
}

/** Where the seat is, sent when it changed. Asked on every navigation
 * event and, as a backstop, about once a second while frames flow: a
 * cross-site navigation can swap the page's process under the session. */
async function sendHistory(cdp, ws, state) {
  try {
    state.historyAt = Date.now();
    const history = await cdp.send("Page.getNavigationHistory", {}, 3000);
    const index = Number(history.currentIndex) || 0;
    const entries = Array.isArray(history.entries) ? history.entries : [];
    const current = entries[index] || {};
    const message = JSON.stringify({ t: "page", url: String(current.url || ""), title: String(current.title || ""), back: index > 0, forward: index < entries.length - 1 });
    if (message === state.lastPage) return;
    state.lastPage = message;
    ws.sendText(message);
  } catch {}
}

/** The restored agent page can be a background tab because Chrome also opens
 * its command-line about:blank tab. Screencast does not paint that hidden
 * target autonomously, so make the selected page the active tab. */
async function activatePage(cdp) {
  await cdp.send("Page.bringToFront", {}, 5000);
}

/** One person on one seat, for as long as the socket lives. */
async function controlSession(ws, query) {
  if (!secretMatches(query.get("k"))) { ws.sendText(JSON.stringify({ t: "error", error: "refused" })); ws.close(); return; }
  const seat = seatIfAny(safeSlug(query.get("agent")));
  if (!seat) { ws.sendText(JSON.stringify({ t: "error", error: "no such seat" })); ws.close(); return; }
  seat.displayName = (await ensureDisplay(seat.display)) || "headless";
  await ensureChrome(seat);
  const page = await mainPage(seat.port);
  const cdp = await new Cdp(page.webSocketDebuggerUrl).open();
  const state = { pressed: false, clickCount: 1, lastDown: null, historyAt: 0, lastPage: "" };
  let queue = Promise.resolve();
  const enqueue = (work) => { queue = queue.then(work, work).catch(() => undefined); };
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cdp.send("Page.stopScreencast", {}, 2000).catch(() => undefined).finally(() => cdp.close());
  };
  cdp.onClose = () => { ws.close(); };
  ws.onclose = stop;
  ws.onmessage = (message) => {
    if (Buffer.isBuffer(message)) return;
    let event;
    try { event = JSON.parse(message); } catch { return; }
    if (!event || typeof event !== "object") return;
    if (event.t === "ping") { ws.sendText(JSON.stringify({ t: "pong", n: event.n })); return; }
    if (event.t === "input") { enqueue(() => dispatchInput(cdp, event, state)); return; }
    if (event.t === "nav") {
      enqueue(async () => {
        if (event.what === "reload") { await cdp.send("Page.reload", {}, 5000); await activatePage(cdp); return; }
        if (event.what === "url") { if (/^https?:\/\//i.test(String(event.url || ""))) { await cdp.send("Page.navigate", { url: String(event.url) }, 10000); await activatePage(cdp); } return; }
        const history = await cdp.send("Page.getNavigationHistory", {}, 3000);
        const index = Number(history.currentIndex) || 0;
        const target = (Array.isArray(history.entries) ? history.entries : [])[event.what === "back" ? index - 1 : index + 1];
        if (target && Number.isInteger(target.id)) { await cdp.send("Page.navigateToHistoryEntry", { entryId: target.id }, 5000); await activatePage(cdp); }
      });
    }
  };
  cdp.on("Page.screencastFrame", (params) => {
    cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }, 3000).catch(() => undefined);
    if (ws.closed) return;
    const meta = params.metadata || {};
    const width = Math.round(meta.deviceWidth || W);
    const height = Math.round(meta.deviceHeight || H);
    if (width !== state.width || height !== state.height) {
      state.width = width; state.height = height;
      ws.sendText(JSON.stringify({ t: "size", width, height }));
    }
    // Behind a slow route, a stale frame is worse than a skipped one.
    if (ws.backlog() > 512 * 1024) return;
    ws.sendBinary(Buffer.from(String(params.data || ""), "base64"));
    if (Date.now() - state.historyAt > 1000) void sendHistory(cdp, ws, state);
  });
  cdp.on("Page.frameNavigated", (params) => { if (params.frame && !params.frame.parentId) void sendHistory(cdp, ws, state); });
  await cdp.send("Page.enable", {});
  await activatePage(cdp);
  ws.sendText(JSON.stringify({ t: "ready", seat: ":" + seat.display }));
  await sendHistory(cdp, ws, state);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: CONTROL_QUALITY, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
}

function daemon() {
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true, path: process.argv[1] }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== "/control") { socket.destroy(); return; }
    const ws = acceptWebSocket(request, socket, head);
    if (!ws) return;
    controlSession(ws, url.searchParams).catch((error) => {
      try { ws.sendText(JSON.stringify({ t: "error", error: error instanceof Error ? error.message : String(error) })); } catch {}
      ws.close();
    });
  });
  server.on("error", () => process.exit(1));
  server.listen(CONTROL_PORT, "0.0.0.0");
}

async function main() {
  if (process.argv[2] === "--daemon") return daemon();
  const request = JSON.parse(Buffer.from(process.argv[2] || "", "base64").toString("utf8"));
  if (request.op === "shutdown") return out({ ok: true, closed: await shutdown() });
  const slug = safeSlug(request.agent);
  const seat = seatFor(slug);
  seat.displayName = (await ensureDisplay(seat.display)) || "headless";
  await ensureChrome(seat);
  const page = await mainPage(seat.port);
  const cdp = await new Cdp(page.webSocketDebuggerUrl).open();
  const base = { display: seat.displayName, port: seat.port, profile: seat.profile };
  try {
    const pid = pgrep("--user-data-dir=" + seat.profile + " ")[0] || pgrep("--user-data-dir=" + seat.profile)[0];
    if (pid) base.browserPid = pid;
    await cdp.send("Page.enable", {});
    if (request.op === "cookies") return out({ ok: true, ...base, cookieHosts: await cookieHosts(cdp) });
    if (request.op === "control") {
      if (typeof request.secret !== "string" || request.secret.length < 16) throw new Error("no control secret");
      writeControl(request.secret);
      await ensureDaemon();
      const frame = await look(cdp, true);
      return out({ ok: true, ...base, control: { port: CONTROL_PORT }, ...frame, cookieHosts: await cookieHosts(cdp) });
    }
    if (request.op === "download") return out({ ok: true, ...base, download: await download(cdp, seat.dir, String(request.url || "")) });
    let completed = 0;
    let failure = "";
    if (request.op === "act") {
      try {
        for (const action of request.actions || []) { await run(cdp, action); completed += 1; }
        await foldPopups(seat.port, cdp, page.id);
        const wait = Math.max(0, Math.min(MAX_SETTLE, Number(request.settleMs) || 0));
        if (wait) await sleep(wait);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }
    const frame = await look(cdp, true);
    return out({ ok: !failure, ...(failure ? { error: failure } : {}), ...base, completed, ...frame, cookieHosts: await cookieHosts(cdp) });
  } finally {
    cdp.close();
  }
}

main().then(() => { if (process.argv[2] !== "--daemon") finish(); }, (error) => {
  out({ ok: false, error: error instanceof Error ? error.message : String(error) });
  finish();
});
`;
