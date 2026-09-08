// What a model is allowed to ask the computer to do, and where it may go.
//
// Pure on purpose: every rule that decides whether an action happens is
// testable without Electron, because the ones that matter are refusals.
//
// The wire shape is Rakazo's (`packages/adapters/src/computer-tools.ts`,
// Apache-2.0): `{kind, x, y, button, double, text, key, modifiers, direction,
// amount, ms}`, at most 24 per batch, a `click` with `double` expanding to two
// pointer events. Two kinds are added because this backend drives a PAGE rather
// than an X display — `navigate`, and a `click`/`type` that names a CSS selector
// instead of a coordinate — and one is deliberately absent: `launch`, because
// there is no application to launch.
import { MAX_ACTIONS, MAX_SETTLE_MS, type ComputerAction } from "./types.js";

export class ComputerActionError extends Error {}

/**
 * Where the agent's browser may go.
 *
 * `http:`/`https:` and nothing else. The three that are refused are refused for
 * three different reasons and all three have been someone's exploit:
 *   `file:`        — the agent's browser runs under the user's account; a
 *                    `file:` navigation reads this Mac with no Access grant and
 *                    no card, and then the page's own script can post it out.
 *   `javascript:`  — a "navigation" that is really code in whatever document is
 *                    already loaded, i.e. a way to act on a signed-in host
 *                    without ever asking to act on it.
 *   `data:`/`blob:`— a document of the model's own writing, same origin as
 *                    nothing, useful only for smuggling.
 * Credentials in the authority (`https://user:pass@host/`) are refused too: they
 * are a way to make one host LOOK like another in every sentence we print.
 */
export function isNavigableUrl(candidate: string): boolean {
  return parseNavigable(candidate) !== null;
}

export function parseNavigable(candidate: string): URL | null {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  return url;
}

/** The host an action lands on, lowercased and without a trailing dot — the
 * unit an approval is remembered against. */
export function hostOf(candidate: string): string {
  return parseNavigable(candidate)?.hostname.toLowerCase().replace(/\.$/, "") ?? "";
}

function finiteCoordinate(value: unknown, name: string): number {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 0 || number > 100_000) {
    throw new ComputerActionError(`computer action ${name} must be a non-negative coordinate`);
  }
  return number;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

/**
 * A CSS selector, as a string this process is willing to hand to
 * `document.querySelector` inside the page.
 *
 * It is interpolated into an injected script, so the only characters that could
 * end the string literal are what has to go: quotes, backslashes, backticks and
 * line breaks. Everything else a selector legitimately contains — brackets,
 * `#`, `.`, `>`, `:` — is left alone.
 */
export function safeSelector(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new ComputerActionError("that action needs a selector");
  if (raw.length > 300) throw new ComputerActionError("that selector is too long");
  if (/["'`\\\r\n\u2028\u2029]/.test(raw)) {
    throw new ComputerActionError("a selector cannot contain quotes, backslashes or line breaks");
  }
  return raw;
}

/** Text the agent types. Control characters are stripped for the same reason a
 * bot name is a single line: they are indistinguishable from keystrokes. */
function typedText(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value ?? "");
  // eslint-disable-next-line no-control-regex -- the control range IS the check
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 4000);
}

const KEY_NAME = /^[A-Za-z0-9]{1,20}$/;
const MODIFIERS = new Set(["shift", "control", "alt", "meta", "cmd", "command", "ctrl"]);

function normalizedModifiers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value.slice(0, 4)) {
    const name = String(raw).toLowerCase();
    if (!MODIFIERS.has(name)) continue;
    const electron = name === "cmd" || name === "command" ? "meta" : name === "ctrl" ? "control" : name;
    if (!out.includes(electron)) out.push(electron);
  }
  return out;
}

/**
 * The batch a model sent, as actions a backend can run — or a refusal that says
 * which one it choked on.
 *
 * Refusing the WHOLE batch on one bad action is deliberate: the batch is
 * ordered, so running the first three of five and stopping leaves the page in a
 * state the model did not plan and cannot see without observing again.
 */
export function parseComputerActions(value: unknown): ComputerAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ComputerActionError("computer_act requires at least one action");
  }
  if (value.length > MAX_ACTIONS) {
    throw new ComputerActionError(`computer_act accepts at most ${MAX_ACTIONS} actions`);
  }
  const actions = value.flatMap((raw): ComputerAction[] => {
    if (!raw || typeof raw !== "object") throw new ComputerActionError("a computer action must be an object");
    const action = raw as Record<string, unknown>;
    const kind = String(action.kind ?? "");
    const button: "left" | "right" = action.button === "right" ? "right" : "left";

    if (kind === "navigate" || kind === "open") {
      const url = parseNavigable(String(action.url ?? action.path ?? ""));
      if (!url) {
        throw new ComputerActionError(
          "a computer can only open an http(s) address — not a file, a data: document or a javascript: link",
        );
      }
      return [{ kind: "navigate", url: url.href }];
    }
    if (kind === "click" || kind === "move" || kind === "down" || kind === "up") {
      if (kind === "click" && action.selector !== undefined) {
        const one: ComputerAction = { kind: "clickSelector", selector: safeSelector(action.selector), button };
        return action.double === true ? [one, one] : [one];
      }
      const pointer: ComputerAction = {
        kind: "pointer",
        x: finiteCoordinate(action.x, "x"),
        y: finiteCoordinate(action.y, "y"),
        type: kind,
        button,
      };
      return action.double === true && kind === "click" ? [pointer, pointer] : [pointer];
    }
    if (kind === "type") {
      const text = typedText(action.text);
      return [
        action.selector === undefined
          ? { kind: "type", text }
          : { kind: "type", text, selector: safeSelector(action.selector) },
      ];
    }
    if (kind === "key") {
      const key = String(action.key ?? "");
      if (!KEY_NAME.test(key)) {
        throw new ComputerActionError("a key is a name like Enter, Tab, Escape or a single character");
      }
      return [{ kind: "key", key, modifiers: normalizedModifiers(action.modifiers) }];
    }
    if (kind === "scroll") {
      return [
        {
          kind: "scroll",
          direction: action.direction === "up" ? "up" : "down",
          amount: boundedNumber(action.amount, 1, 20, 3),
        },
      ];
    }
    if (kind === "wait") {
      return [{ kind: "wait", ms: boundedNumber(action.ms, 0, 5_000, 350) }];
    }
    throw new ComputerActionError(`unsupported computer action ${kind || "(missing)"}`);
  });
  if (actions.length > MAX_ACTIONS) {
    throw new ComputerActionError(`computer_act expands to more than ${MAX_ACTIONS} actions; split the batch`);
  }
  return actions;
}

/** How long to wait for the page to settle after a batch. */
export function settleMs(value: unknown): number {
  return boundedNumber(value, 0, MAX_SETTLE_MS, 600);
}

/**
 * Every host a batch would touch, in order, deduplicated.
 *
 * Only `navigate` names one: a click, a keystroke or a scroll acts on WHERE THE
 * PAGE ALREADY IS, and the caller pairs this with the current URL. That pairing
 * is the whole approval rule — see `hostsNeedingApproval`.
 */
export function hostsTouched(actions: ComputerAction[], currentUrl: string): string[] {
  const hosts: string[] = [];
  const push = (host: string): void => {
    if (host && !hosts.includes(host)) hosts.push(host);
  };
  const actsOnCurrentPage = actions.some((action) => action.kind !== "navigate" && action.kind !== "wait");
  if (actsOnCurrentPage) push(hostOf(currentUrl));
  for (const action of actions) if (action.kind === "navigate") push(hostOf(action.url));
  return hosts;
}

/**
 * Which of those hosts the user has to be asked about.
 *
 * The rule, in one line: **a session cookie is a password**. Reading a page
 * nobody signed into is browsing; acting on a host this agent's partition holds
 * cookies for is acting AS the user on an account they logged into by hand, and
 * that is a card every time until they say "always".
 *
 * `signedIn` is the set the backend read out of the agent's own partition, and
 * `remembered` is what `allow_always` already covers.
 */
export function hostsNeedingApproval(
  touched: readonly string[],
  signedIn: readonly string[],
  remembered: (host: string) => boolean,
): string[] {
  const known = new Set(signedIn.map((host) => host.toLowerCase()));
  return touched.filter((host) => {
    if (!host) return false;
    const signed = known.has(host) || [...known].some((candidate) => host.endsWith(`.${candidate}`));
    return signed && !remembered(host);
  });
}
