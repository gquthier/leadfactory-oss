// What a routine (or heartbeat) turn is told when it wakes, and how its reply
// is read back. The bot should feel like a person texting first: it folds the
// result in casually, never says "routine triggered", and stays quiet when
// there is nothing new — `[SILENT]` is how it says so.

/** A reply that is exactly this publishes nothing. */
export const SILENT_TOKEN = "[SILENT]";
/** A reply that ends with this ends the routine after it is delivered. */
export const DONE_TOKEN = "[DONE]";
/** Continuity budget: the previous report is quoted, never whole. */
export const MAX_REPORT_CHARS = 1_200;

export function truncateReport(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_REPORT_CHARS ? `${trimmed.slice(0, MAX_REPORT_CHARS - 1)}…` : trimmed;
}

function localTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export interface RoutineRunPromptInput {
  name: string;
  /** The intent the routine's author wrote to its future self. */
  prompt: string;
  /** The window passed while the app was closed; this run is late. */
  missed?: boolean;
  /** The previous NON-silent result, for continuity. */
  previousReport?: { text: string; at: string } | undefined;
  endsAt?: string | undefined;
  /** No further run will happen after this one (its end is reached). */
  finalRun?: boolean;
}

/** The text a routine turn is started with. Short on purpose. */
export function routineRunPrompt(input: RoutineRunPromptInput): string {
  const lines = [
    `[routine "${input.name}"] You are waking up for your routine. Your note to yourself:`,
    input.prompt.trim(),
    "",
    "Deliver the result like a casual text to the person, folded in naturally (\"btw, …\"). Never announce that a routine triggered or ran.",
    `If there is nothing new or worth saying, reply exactly ${SILENT_TOKEN} and nothing else.`,
  ];
  if (input.previousReport?.text.trim()) {
    lines.push(
      `What you already reported last time (${localTime(input.previousReport.at)}) — don't repeat it, only what changed:`,
      `"""${truncateReport(input.previousReport.text)}"""`,
    );
  }
  if (input.endsAt) {
    lines.push(
      input.finalRun
        ? `This watch ends at ${localTime(input.endsAt)}: this is its last check. Report the outcome once and end your reply with ${DONE_TOKEN}.`
        : `This watch ends at ${localTime(input.endsAt)}. If that has passed or the watched thing is finished, report it once and end your reply with ${DONE_TOKEN}; the routine then stops.`,
    );
  } else {
    lines.push(`If the watched thing is finished for good, report it once and end your reply with ${DONE_TOKEN}; the routine then stops.`);
  }
  if (input.missed) lines.push("(This was due while BizOS was closed; it is running late.)");
  return lines.join("\n");
}

export interface ClassifiedReply {
  /** Nothing is published and no `routine.fired` is emitted. */
  silent: boolean;
  /** The owner said the watched thing is over: the routine ends. */
  done: boolean;
  /** The texts to publish, markers removed, empty ones dropped. */
  texts: string[];
}

const DONE_MARK = /\s*\[DONE\]\s*$/i;

/**
 * Read a quiet turn's buffered assistant texts.
 *
 * Silent when the final text is exactly `[SILENT]`, or when every non-empty
 * text is — commentary that preceded a silent verdict is not a reply either.
 * A trailing `[DONE]` is stripped and ends the routine.
 */
export function classifyRoutineReply(raw: readonly string[]): ClassifiedReply {
  const nonEmpty = raw.map((text) => text.trim()).filter(Boolean);
  let done = false;
  const stripped = nonEmpty.map((text) => {
    if (!DONE_MARK.test(text)) return text;
    done = true;
    return text.replace(DONE_MARK, "").trim();
  });
  const isSilent = (text: string) => text === SILENT_TOKEN || text.replace(/\s+/g, "") === SILENT_TOKEN;
  const last = stripped.at(-1);
  const silent = !stripped.length
    || (last !== undefined && isSilent(last))
    || stripped.every((text) => !text || isSilent(text));
  return {
    silent,
    done,
    texts: silent ? [] : stripped.filter((text) => text && !isSilent(text)),
  };
}
