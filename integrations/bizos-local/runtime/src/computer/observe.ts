// Looking at the page, and saying what is on it.
//
// Two halves, both pure so both are testable without a browser:
//   * the SCRIPTS injected into the agent's page. They are built here, in one
//     place, and every value that reaches them goes through `JSON.stringify`
//     — a selector or a piece of text is a STRING inside that script, and a
//     string that can end itself is a page choosing what this process runs.
//   * `formatObservation`, which turns a look into the sentences the model
//     reads. It is the only place page content is written into the turn, and it
//     writes it fenced (`untrustedBlock`): everything the page says is data.
import { untrustedBlock, type ComputerObservation, type ObservedElement } from "./types.js";

/** How many actionable things one look reports. More than this is a page the
 * model should narrow down, not a list it should read. */
export const MAX_ELEMENTS = 40;
/** How much of the page's own text travels with a look. */
export const MAX_PAGE_TEXT = 4000;

/**
 * The probe.
 *
 * It reports what a person could CLICK OR TYPE INTO and where, plus the page's
 * visible text — never the DOM, never scripts, never anything from a frame it
 * cannot reach. It is deliberately shallow: a summary the model can act on
 * beats a serialization it has to parse.
 *
 * Selectors come back in a form `document.querySelector` accepts and
 * `safeSelector` will re-accept: an `#id` when the id is a plain identifier,
 * otherwise an `:nth-child` path. No attribute selector, because those carry
 * quotes and quotes are what the escaping above exists to keep out.
 */
export function pageProbeScript(maxElements = MAX_ELEMENTS, maxText = MAX_PAGE_TEXT): string {
  return `(() => {
  const IDENT = /^[A-Za-z][A-Za-z0-9_-]*$/;
  const path = (node) => {
    if (node.id && IDENT.test(node.id)) return "#" + node.id;
    const parts = [];
    let current = node;
    while (current && current.nodeType === 1 && parts.length < 8) {
      if (current.id && IDENT.test(current.id)) { parts.unshift("#" + current.id); break; }
      const parent = current.parentElement;
      if (!parent) { parts.unshift(current.tagName.toLowerCase()); break; }
      const index = Array.prototype.indexOf.call(parent.children, current) + 1;
      parts.unshift(current.tagName.toLowerCase() + ":nth-child(" + index + ")");
      current = parent;
    }
    return parts.join(" > ");
  };
  const roleOf = (node) => {
    const tag = node.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    if (tag === "input") return "input:" + (node.type || "text");
    return node.getAttribute("role") || tag;
  };
  const labelOf = (node) => {
    const text = (node.innerText || node.value || node.getAttribute("aria-label") || node.getAttribute("placeholder") || node.getAttribute("title") || "").replace(/\\s+/g, " ").trim();
    return text.slice(0, 120);
  };
  const elements = [];
  const candidates = document.querySelectorAll("a[href], button, input, select, textarea, [role=button], [role=link], [onclick]");
  for (const node of candidates) {
    if (elements.length >= ${maxElements}) break;
    if (node.disabled === true) continue;
    if (node.type === "hidden") continue;
    const box = node.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const entry = {
      selector: path(node),
      role: roleOf(node),
      label: labelOf(node),
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };
    if (node.tagName.toLowerCase() === "a" && node.href) entry.href = String(node.href).slice(0, 500);
    if (!entry.selector) continue;
    elements.push(entry);
  }
  const body = document.body ? (document.body.innerText || "") : "";
  return {
    url: String(location.href).slice(0, 2048),
    title: String(document.title || "").slice(0, 300),
    text: body.replace(/[ \\t]+/g, " ").replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, ${maxText}),
    elements,
  };
})()`;
}

/** Click what a selector names, from inside the page. Answers whether it found
 * anything: a click on nothing is a refusal the model has to see, not a silent
 * success it will build three more actions on top of. */
export function clickSelectorScript(selector: string): string {
  return `(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return { ok: false, reason: "no element matches that selector" };
  node.scrollIntoView({ block: "center", inline: "center" });
  if (typeof node.focus === "function") node.focus();
  node.click();
  return { ok: true };
})()`;
}

/** Put text in a field, the way a person would: focus it, replace what is
 * there, and fire the events every framework listens for. */
export function typeIntoScript(selector: string, text: string): string {
  return `(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!node) return { ok: false, reason: "no element matches that selector" };
  node.scrollIntoView({ block: "center", inline: "center" });
  node.focus();
  const value = ${JSON.stringify(text)};
  if ("value" in node) {
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (node.isContentEditable) {
    node.textContent = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    return { ok: false, reason: "that element is not something you can type into" };
  }
  return { ok: true };
})()`;
}

export function scrollScript(direction: "up" | "down", amount: number): string {
  const delta = (direction === "up" ? -1 : 1) * Math.max(1, amount) * 300;
  return `(() => { window.scrollBy({ top: ${delta}, behavior: "instant" }); return { ok: true }; })()`;
}

/** A raw probe result, believed only as far as its shape goes. It came back
 * from a page: every field is re-checked here rather than cast. */
export function readProbe(raw: unknown): {
  url: string;
  title: string;
  text: string;
  elements: ObservedElement[];
} {
  const record = (raw ?? {}) as Record<string, unknown>;
  const elements: ObservedElement[] = [];
  if (Array.isArray(record.elements)) {
    for (const candidate of record.elements.slice(0, MAX_ELEMENTS)) {
      if (!candidate || typeof candidate !== "object") continue;
      const entry = candidate as Record<string, unknown>;
      if (typeof entry.selector !== "string" || !entry.selector) continue;
      elements.push({
        selector: entry.selector.slice(0, 300),
        role: typeof entry.role === "string" ? entry.role.slice(0, 40) : "element",
        label: typeof entry.label === "string" ? entry.label.slice(0, 120) : "",
        ...(typeof entry.href === "string" ? { href: entry.href.slice(0, 500) } : {}),
        x: Number.isFinite(Number(entry.x)) ? Math.round(Number(entry.x)) : 0,
        y: Number.isFinite(Number(entry.y)) ? Math.round(Number(entry.y)) : 0,
      });
    }
  }
  return {
    url: typeof record.url === "string" ? record.url.slice(0, 2048) : "",
    title: typeof record.title === "string" ? record.title.slice(0, 300) : "",
    text: typeof record.text === "string" ? record.text.slice(0, MAX_PAGE_TEXT) : "",
    elements,
  };
}

/**
 * A look, as the sentences a model reads.
 *
 * The order is the point: where it IS, then what it can DO, then — fenced and
 * labelled — what the page SAYS. A model that reads the fence first has already
 * read a paragraph of somebody else's instructions before being told what they
 * are.
 */
export function formatObservation(observation: ComputerObservation): string {
  const lines = [
    `Screen ${observation.width}x${observation.height}, captured ${observation.capturedAt} (frame ${observation.frameId}).`,
    `Page: ${observation.title || "(untitled)"} — ${observation.url || "(blank)"}`,
  ];
  if (observation.elements.length) {
    lines.push("", "Things you can act on (pass the selector to computer_act):");
    for (const element of observation.elements) {
      const label = element.label ? ` "${element.label}"` : "";
      const href = element.href ? ` -> ${element.href}` : "";
      lines.push(`- ${element.role}${label} [${element.selector}] at (${element.x},${element.y})${href}`);
    }
  } else {
    lines.push("", "Nothing on this page is clickable or typeable right now.");
  }
  if (observation.text) lines.push("", untrustedBlock(observation.text));
  return lines.join("\n");
}
