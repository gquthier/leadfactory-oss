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
// of that agent's screen. The page-side scripts (the probe, the selector
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
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, createWriteStream, statSync } from "node:fs";
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

async function ensureChrome(seat) {
  if (await devtools(seat.port)) return { display: seat.displayName };
  mkdirSync(seat.profile, { recursive: true });
  // A Chrome that holds this profile but does not answer is a stuck one; a
  // lock with no Chrome behind it is a leftover of the last snapshot.
  for (const pid of pgrep("--user-data-dir=" + seat.profile)) { try { process.kill(pid, "SIGKILL"); } catch {} }
  await sleep(200);
  clearProfileLocks(seat.profile);
  const args = [
    "--user-data-dir=" + seat.profile,
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
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.waiters = []; }
  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error("DevTools did not answer")), 8000);
      ws.onopen = () => { clearTimeout(timer); resolve(this); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("DevTools connection failed")); };
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

async function main() {
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

main().then(finish, (error) => {
  out({ ok: false, error: error instanceof Error ? error.message : String(error) });
  finish();
});
`;
