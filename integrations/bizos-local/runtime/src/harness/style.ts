// How a bot talks, and how the harness delivers what it said.
//
// Local BizOS is a messaging app before it is anything else. The user is in
// a thread that looks like WhatsApp, so a bot that answers with a heading, a
// table and six bullet points is wrong the way a friend texting you a memo
// would be wrong. Three rules live here, in one place, because they have to
// agree with each other:
//
//   * `CHAT_STYLE` — the STYLE section of the persona prompt (`prompt.ts`):
//     what the model is asked to write.
//   * `labelForTool` — what a tool call is called. The user sees "Reading
//     company state", never `get_company_state`. Present progressive, because
//     the SAME string is read while it happens (the "is working" tooltip) and
//     afterwards; the renderer's own table (`lib/localbizos/format.ts`) says it
//     the same way, so the two runtimes speak one vocabulary.
//   * `approvalTitle` — the sentence an approval card asks. "Allow Vega to run
//     an operation in BizOS?", never codex's `Allow the bizos_actions MCP
//     server to run tool "run_operation"?`.
//
// What is NOT here any more: `splitIntoBubbles`. A reply used to be cut twice —
// once by the renderer as it streamed, and again here when the turn ended — and
// the second cut DELETED paragraphs the reader had already read, re-sending them
// as new messages a few hundred milliseconds later. There is one cutter now, and
// it is `src/lib/localbizos/bubbles.ts` on the renderer's side, where the text
// can be re-cut on every frame without ever moving a word that is on screen.
// `CHAT_STYLE` still ASKS for short paragraphs, which is what makes the cut
// meaningful; the harness simply no longer performs it.

/** The length the prompt asks for. Not enforced — a hard truncation would
 * cut a sentence in half — but stated, because a target the model can see is
 * what actually moves the average message length down. */
export const TARGET_WORDS_PER_MESSAGE = 60;

export const CHAT_STYLE = [
  "How you write:",
  "- This is a chat, like WhatsApp or Messages. One idea per message, 1 to 3 sentences," +
    ` ${TARGET_WORDS_PER_MESSAGE} words at most. Everyday language.`,
  "- If you have two things to say, separate them with a blank line: each block is sent as its own message, one after the other.",
  "- ONE question at a time. Never a list of questions.",
  "- Same language as the user, and the same register: if they are informal with you, be informal back.",
  "- No headings, no tables, no bold (**text**), no emoji unless the user uses them. A list only if the user asked for a recap. Prefer plain sentences and links; never heavy markdown.",
  "- Before you use a tool, say what you are about to do in one human line (\"Let me look at the state of the business.\"). After it, give the result in one line. Never a tool name, never JSON, never an identifier.",
  "- Every number you give comes from a tool you called in this turn. If you have none, say you do not know yet and what you are going to do about it.",
  "- Finish on the next concrete step or on a question. Never on a summary of what you just said.",
].join("\n");

/** The group half of the style: when to speak, and how to hand over. */
export const GROUP_CHAT_STYLE = [
  "Answer only if you were mentioned or if this is your job.",
  "Otherwise say nothing at all — an empty answer is a real answer here.",
  "To hand over, one sentence and @Name.",
].join(" ");

/** What each BizOS tool is called in front of a human. */
export const TOOL_LABELS: Record<string, string> = {
  ask_ceo: "Asking the BizOS CEO",
  get_activity: "Reading recent activity",
  get_ads_status: "Reading the ads status",
  get_company_state: "Reading company state",
  get_document: "Reading a document",
  get_operation_result: "Reading an operation result",
  list_creatives: "Listing the creatives",
  list_documents: "Listing the documents",
  list_emails: "Checking the inbox",
  list_leads: "Listing the leads",
  list_routines: "Listing the routines",
  list_sites: "Listing the sites",
  list_tasks: "Listing the tasks",
  mark_email_read: "Marking an email read",
  pause_routine: "Pausing a routine",
  resume_routine: "Resuming a routine",
  run_operation: "Running an operation in BizOS",
  // The agent's computer. Named for what a person watching would say it is
  // doing, never for the tool: "Looking at its screen", not `computer_observe`.
  computer_observe: "Looking at its screen",
  computer_act: "Using its computer",
  computer_download: "Downloading a file",
  upload_document: "Saving a document",
  // codex's own item types, which arrive under these titles.
  edit: "Editing a file",
  shell: "Running a command",
  web_search: "Searching the web",
};

/**
 * The same tools, in the INFINITIVE, for the one sentence that has to read as a
 * request rather than as a report: "Allow Vega to run an operation in BizOS?".
 *
 * It is a second table and not a conjugation of the first because English will
 * not give you one reliably ("Checking the inbox" → "check the inbox" happens to
 * work, "Saving a document" → "save a document" too, but "Reading company state"
 * → "read company state" reads like a command, not a request). Six lines of table
 * beat a stemmer that is wrong once a week in front of a permission dialog.
 */
export const APPROVAL_LABELS: Record<string, string> = {
  ask_ceo: "ask the BizOS CEO",
  get_activity: "read what happened recently",
  get_ads_status: "check the ads",
  get_company_state: "read the company state",
  get_document: "open a document",
  get_operation_result: "check how an operation went",
  list_creatives: "look at the creatives",
  list_documents: "look through the documents",
  list_emails: "check the inbox",
  list_leads: "look at the leads",
  list_routines: "look at the routines",
  list_sites: "look at the sites",
  list_tasks: "look at the task list",
  mark_email_read: "mark an email as read",
  pause_routine: "pause a routine",
  resume_routine: "restart a routine",
  run_operation: "run an operation in BizOS",
  computer_observe: "look at its own screen",
  computer_act: "use its computer",
  computer_download: "download a file",
  // The card the computer raises itself carries its own whole sentence
  // ("Allow Vega to act on github.com?"), so this entry is the fallback for a
  // build that somehow lost it — not the usual path.
  computer: "use its computer",
  upload_document: "save a document",
  edit: "edit files on this Mac",
  shell: "run a command on this Mac",
  web_search: "search the web",
  mcp: "use one of its tools",
};

/** Prefix → infinitive verb, for a tool no table names. */
const APPROVAL_VERB_FOR_PREFIX: Array<[RegExp, string]> = [
  [/^(?:get|read|fetch|show|describe)_/, "read"],
  [/^(?:list|check|inspect)_/, "check"],
  [/^(?:create|add|new|generate)_/, "create"],
  [/^(?:update|set|edit|rename)_/, "update"],
  [/^(?:delete|remove|archive)_/, "delete"],
  [/^(?:send|publish|post)_/, "send"],
  [/^(?:run|start|launch)_/, "run"],
  [/^search_/, "search"],
  [/^(?:upload|save|write|store)_/, "save"],
  [/^(?:pause|stop|cancel)_/, "pause"],
];

/**
 * What the teammate is asking to be allowed to DO, in words a person answers.
 *
 * Never the server that serves the tool ("bizos_actions"), never an identifier,
 * never a quoted symbol — those are what turned a permission question into
 * `Allow the bizos*actions MCP server to run tool "run*operation"?` once the
 * markdown renderer had eaten its underscores.
 */
export function approvalActionLabel(tool: string): string {
  const raw = String(tool ?? "").trim();
  if (!raw) return "do this";
  const named = APPROVAL_LABELS[raw];
  if (named) return named;
  const bare = bareToolName(raw);
  const namespaced = APPROVAL_LABELS[bare];
  if (namespaced) return namespaced;
  if (!/^[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*$/.test(bare)) return "run a command on this Mac";
  const snake = toSnake(bare);
  for (const [prefix, verb] of APPROVAL_VERB_FOR_PREFIX) {
    if (!prefix.test(snake)) continue;
    const rest = humanize(snake.replace(/^[a-z]+_/, ""));
    return rest ? `${verb} ${rest}` : verb;
  }
  return `use ${humanize(snake)}`;
}

/**
 * The whole sentence a card asks: "Allow Vega to run an operation in BizOS?".
 *
 * A QUESTION the teammate asked ("which account should I use?") is not an
 * approval and keeps whatever it actually asked — `fallback`.
 */
export function approvalTitle(input: {
  botName: string;
  tool: string;
  requestType: "permission" | "question";
  fallback?: string;
}): string {
  const fallback = (input.fallback ?? "").trim();
  if (input.requestType === "question") return fallback || "Your input is needed.";
  const who = input.botName.trim() || "this teammate";
  return `Allow ${who} to ${approvalActionLabel(input.tool)}?`;
}

/** Prefix → verb, for a tool the table does not name. */
const VERB_FOR_PREFIX: Array<[RegExp, string]> = [
  [/^(?:get|read|fetch|show|describe)_/, "Reading"],
  [/^(?:list|check|inspect)_/, "Checking"],
  [/^(?:create|add|new|generate)_/, "Creating"],
  [/^(?:update|set|edit|rename)_/, "Updating"],
  [/^(?:delete|remove|archive)_/, "Deleting"],
  [/^(?:send|publish|post)_/, "Sending"],
  [/^(?:run|start|launch)_/, "Running"],
  [/^search_/, "Searching"],
  [/^(?:upload|save|write|store)_/, "Saving"],
  [/^(?:pause|stop|cancel)_/, "Pausing"],
];

/** `mcpToolCall` titles can arrive namespaced by the server that serves
 * them (`bizos__get_company_state`, `bizos_actions.run_operation`). A slash
 * is deliberately NOT a separator here: `ls -la /Users` is a command, and
 * treating its last segment as a tool name reads as "Used users". */
function bareToolName(title: string): string {
  return title.replace(/^.*(?:__|\.)/, "").trim();
}

function toSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-/g, "_").toLowerCase();
}

function humanize(name: string): string {
  return name.replace(/_/g, " ").trim();
}

/**
 * The line the thread shows for a tool call.
 *
 * The table first, then a verb derived from the tool's own prefix; a title
 * that is not an identifier is a shell command line, and printing it back at
 * the user is jargon, so it becomes "Ran a command".
 */
export function labelForTool(title: string): string {
  const raw = String(title ?? "").trim();
  if (!raw) return "Working on it";
  const named = TOOL_LABELS[raw];
  if (named) return named;
  // `commandExecution` arrives as the command itself. It is not a tool name
  // and it is not for the user to read.
  if (/[\s/]/.test(raw)) return "Running a command";

  const bare = bareToolName(raw);
  const namespaced = TOOL_LABELS[bare];
  if (namespaced) return namespaced;
  if (!/^[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*$/.test(bare)) return "Running a command";

  const snake = toSnake(bare);
  for (const [prefix, verb] of VERB_FOR_PREFIX) {
    if (!prefix.test(snake)) continue;
    const rest = humanize(snake.replace(/^[a-z]+_/, ""));
    return rest ? `${verb} ${rest}` : verb;
  }
  return `Using ${humanize(snake)}`;
}
