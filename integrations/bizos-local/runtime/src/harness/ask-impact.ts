// What a permission card says about the weight of what it asks.
//
// The approvals spec (docs/specs/chat-outputs/04-approvals.md) wants a card to
// say "Send 12 emails · High impact · Cannot be undone" and to offer "Always
// allow" only when that is a sane thing to offer. Owner decision 2026-09-26:
// Always allow is NEVER offered for an irreversible or high-impact action —
// spending money, deleting, sending emails or messages. The runtime knows the
// tool and, for a shell or an edit, the command or the files; this is a best
// effort from those. Unknown ⇒ medium impact, reversibility unknown.
import { approvalActionLabel } from "./style.js";

export type AskImpact = "low" | "medium" | "high";

export type AskDetailsKind = "text" | "command" | "diff" | "recipients";

export interface AskAssessment {
  /** Verb first, the way the card titles it: "Run `ls -la`", "Edit offer.md". */
  action: string;
  /** What it acts on: the command, the file, the recipients, the operation. */
  target?: string;
  impact: AskImpact;
  /** Absent means the runtime cannot tell. */
  reversible?: boolean;
  /** Whether the card may offer "Always allow". Never for high impact or an
   * action known to be irreversible. */
  allowAlways: boolean;
  details?: { kind: AskDetailsKind; text?: string; items?: string[]; added?: number; removed?: number };
}

/** Shell commands that destroy, publish or spend — irreversible from the
 * chat. Checked on every simple command of a pipeline (`a && b | c`). */
const IRREVERSIBLE_COMMANDS: Array<[RegExp, string]> = [
  [/^(?:sudo\s+)?rm\b/, "delete files"],
  [/^(?:sudo\s+)?rmdir\b/, "delete a folder"],
  [/^(?:sudo\s+)?(?:shred|srm)\b/, "delete files"],
  [/^git\s+push\b/, "push to a remote"],
  [/^git\s+(?:reset\s+--hard|clean\s+-[a-z]*f|branch\s+-D|checkout\s+--\s|restore\b)/, "discard changes"],
  [/^git\s+(?:stash\s+drop|stash\s+clear|reflog\s+expire)/, "discard changes"],
  [/^(?:sudo\s+)?(?:mkfs|dd|diskutil|fdisk|parted)\b/, "write to a disk"],
  [/^(?:sudo\s+)?(?:kill|killall|pkill)\b/, "stop a process"],
  [/^(?:sudo\s+)?(?:shutdown|reboot|halt)\b/, "shut the machine down"],
  [/^(?:sudo\s+)?(?:launchctl|systemctl)\s+(?:unload|disable|stop|remove)/, "stop a service"],
  [/^(?:sudo\s+)?(?:truncate|:>|>)\b/, "empty a file"],
  [/^(?:sudo\s+)?(?:defaults\s+delete|security\s+delete)/, "delete settings"],
  [/^(?:curl|wget|http|xh)\b.*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--request\s*(?:POST|PUT|PATCH|DELETE)|--data|-d\s|--form|-F\s|--upload-file|-T\s)/i, "send data to a server"],
  [/^(?:npm|pnpm|yarn)\s+publish\b/, "publish a package"],
  [/^(?:gh|glab)\s+(?:pr|issue|release|repo)\s+(?:create|merge|close|delete|comment|edit)\b/, "act on GitHub"],
  [/^(?:vercel|netlify|railway|fly|wrangler|heroku)\s+(?:deploy|--prod|up|publish)?\b/, "deploy"],
  [/^(?:aws|gcloud|az)\s+.*\b(?:delete|terminate|rm|destroy|remove)\b/, "delete cloud resources"],
  [/^(?:terraform|pulumi)\s+(?:apply|destroy)\b/, "change infrastructure"],
  [/^(?:mail|sendmail|mutt|msmtp|osascript)\b/, "send a message"],
  [/^(?:sudo\s+)?(?:chmod|chown)\s+-R\b/, "change permissions everywhere"],
  [/^(?:sudo\s+)?(?:brew\s+uninstall|apt(?:-get)?\s+(?:remove|purge)|pip\s+uninstall|npm\s+(?:uninstall|rm)\s+-g)\b/, "uninstall software"],
  [/^(?:psql|mysql|sqlite3|mongo(?:sh)?)\b.*\b(?:drop|delete|truncate)\b/i, "delete database rows"],
];

/** Commands that only look. */
const READ_ONLY_COMMANDS = /^(?:ls|ll|la|cat|head|tail|less|more|wc|grep|rg|ag|ack|find|fd|tree|pwd|echo|printf|which|whereis|type|file|stat|du|df|date|whoami|id|uname|env|printenv|history|man|help|true|test|\[|realpath|readlink|basename|dirname|jq|yq|sort|uniq|cut|awk|sed\s+-n|diff|cmp|md5|md5sum|shasum|sha256sum|xxd|hexdump|strings|open\s+-R|git\s+(?:status|log|diff|show|branch(?:\s+(?:-a|-r|-v|--list))?|remote(?:\s+-v)?|rev-parse|describe|blame|ls-files|tag(?:\s+-l)?|stash\s+list|config\s+--get|config\s+-l|config\s+--list)|npm\s+(?:ls|list|view|info|outdated|test|run\s+test)|pnpm\s+(?:ls|list|test)|node\s+-[ev]|python3?\s+--version|ps|top|lsof|netstat|ping|dig|nslookup|host|curl\s+(?:-s\s+)?(?:-I|--head)|ollama\s+list|codex\s+--version|claude\s+--version)\b/;

function simpleCommands(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((part) => part.trim().replace(/^\(+|\)+$/g, "").trim())
    .filter(Boolean);
}

function assessCommand(command: string): { impact: AskImpact; reversible?: boolean; why?: string } {
  const parts = simpleCommands(command);
  if (!parts.length) return { impact: "medium" };
  for (const part of parts) {
    for (const [pattern, why] of IRREVERSIBLE_COMMANDS) {
      if (pattern.test(part)) return { impact: "high", reversible: false, why };
    }
  }
  // `>` redirection overwrites; `>>` appends. Neither is a read.
  if (parts.every((part) => READ_ONLY_COMMANDS.test(part) && !/(?:^|[^>])>(?!>)|\s>>\s/.test(part))) {
    return { impact: "low", reversible: true };
  }
  return { impact: "medium" };
}

/** MCP / dynamic tools, by what their name says they do. */
const TOOL_IMPACT: Array<[RegExp, { impact: AskImpact; reversible?: boolean }]> = [
  [/^(?:get|read|fetch|show|describe|list|check|inspect|search|find|query|status|context|schema|dashboard)(?:_|$)/, { impact: "low", reversible: true }],
  [/^(?:agency|commerce)_(?:context|schema|list_|read_|dashboard|clients|campaigns|tasks|deliverables|records|onboarding)/, { impact: "low", reversible: true }],
  [/^(?:delete|remove|destroy|purge|drop|archive|trash|wipe|clear|reset)(?:_|$)/, { impact: "high", reversible: false }],
  [/^(?:send|publish|post|email|mail|notify|message|reply|forward|broadcast|tweet|share)(?:_|$)/, { impact: "high", reversible: false }],
  [/(?:_|^)(?:send|publish|post|email|sms|charge|pay|payment|purchase|buy|order|refund|spend|transfer|invoice|checkout|subscribe|cancel_subscription|deploy)(?:_|$)/, { impact: "high", reversible: false }],
  [/^(?:mark_email_read|mark_read|unmark)/, { impact: "low", reversible: true }],
  [/^(?:create|add|new|generate|update|set|edit|rename|write|save|upload|store|move|copy|patch|toggle|pause|resume|start|stop|schedule)(?:_|$)/, { impact: "medium", reversible: true }],
  [/^(?:run_operation|run|execute|launch|trigger|invoke)(?:_|$)/, { impact: "medium" }],
  [/^computer_(?:observe)$/, { impact: "low", reversible: true }],
  [/^computer_(?:act|download)$/, { impact: "medium" }],
  [/^cloud_computer_/, { impact: "medium" }],
  [/^(?:recruit_agent|manage_agent|schedule_routine|checkpoint_task|send_to_chat|offer_quick_replies|propose_company_name)$/, { impact: "low", reversible: true }],
];

function bareToolName(tool: string): string {
  return tool.replace(/^.*(?:__|\.)/, "").trim();
}

function toSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-/g, "_").toLowerCase();
}

function capitalize(sentence: string): string {
  return sentence ? sentence[0]!.toUpperCase() + sentence.slice(1) : sentence;
}

/** Email-looking recipients inside a tool's arguments, when the tool sends. */
function recipientsIn(text: string): string[] {
  const found = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return [...new Set(found)].slice(0, 50);
}

/** A unified diff's added / removed line counts. */
function diffCounts(text: string): { added: number; removed: number } | null {
  if (!/^(?:@@|\+\+\+|---|diff )/m.test(text)) return null;
  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

const SHELL_TOOLS = new Set(["shell", "commandExecution", "command", "bash", "Bash", "exec", "terminal"]);
const EDIT_TOOLS = new Set(["edit", "Edit", "Write", "MultiEdit", "NotebookEdit", "fileChange", "applyPatch", "apply_patch"]);

/**
 * The weight of one permission ask, from what the runtime knows about it.
 *
 * `detailText` is what the card shows under Details: the command for a shell
 * approval, the files for an edit, tool + arguments for an MCP call.
 */
export function assessAsk(input: { tool: string; detailText?: string; summary?: string }): AskAssessment {
  const tool = String(input.tool ?? "").trim();
  const bare = bareToolName(tool);
  const detail = String(input.detailText ?? "").trim();
  const summary = String(input.summary ?? "").trim();
  const build = (assessment: Omit<AskAssessment, "allowAlways">): AskAssessment => ({
    ...assessment,
    allowAlways: assessment.impact !== "high" && assessment.reversible !== false,
  });

  if (SHELL_TOOLS.has(tool) || SHELL_TOOLS.has(bare) || /[\s/]/.test(tool)) {
    const command = detail || (/[\s/]/.test(tool) ? tool : "") || summary;
    const verdict = assessCommand(command);
    const firstLine = command.split("\n")[0]!.trim();
    return build({
      action: verdict.why ? capitalize(verdict.why) : `Run ${firstLine ? `\`${firstLine.slice(0, 120)}\`` : "a command"}`,
      ...(firstLine ? { target: firstLine.slice(0, 200) } : {}),
      impact: verdict.impact,
      ...(verdict.reversible !== undefined ? { reversible: verdict.reversible } : {}),
      ...(command ? { details: { kind: "command", text: command.slice(0, 4_000) } } : {}),
    });
  }

  if (EDIT_TOOLS.has(tool) || EDIT_TOOLS.has(bare)) {
    const counts = diffCounts(detail);
    const files = counts ? [] : detail.split("\n").map((line) => line.trim()).filter(Boolean);
    const first = files[0] ?? "";
    const name = first.split("/").filter(Boolean).at(-1) ?? "";
    return build({
      action: files.length > 1 ? `Edit ${files.length} files` : name ? `Edit ${name}` : "Edit files",
      ...(first ? { target: first.slice(0, 300) } : {}),
      impact: "medium",
      reversible: true,
      ...(counts
        ? { details: { kind: "diff", text: detail.slice(0, 8_000), ...counts } }
        : files.length ? { details: { kind: "text", items: files.slice(0, 50) } } : {}),
    });
  }

  const snake = toSnake(bare);
  let weight: { impact: AskImpact; reversible?: boolean } = { impact: "medium" };
  for (const [pattern, verdict] of TOOL_IMPACT) {
    if (pattern.test(snake)) { weight = verdict; break; }
  }
  const sends = /(?:^|_)(?:send|email|mail|message|notify|reply|forward|sms)(?:_|$)/.test(snake);
  const recipients = sends && detail ? recipientsIn(detail) : [];
  const label = approvalActionLabel(tool);
  const action = recipients.length
    ? `Send ${recipients.length === 1 ? "an email" : `${recipients.length} emails`}`
    : capitalize(label);
  return build({
    action,
    ...(recipients.length ? { target: recipients.length === 1 ? recipients[0]! : `${recipients.length} recipients` } : bare && bare !== tool ? { target: bare } : {}),
    impact: weight.impact,
    ...(weight.reversible !== undefined ? { reversible: weight.reversible } : {}),
    ...(recipients.length
      ? { details: { kind: "recipients", items: recipients, ...(detail ? { text: detail.slice(0, 4_000) } : {}) } }
      : detail ? { details: { kind: "text", text: detail.slice(0, 4_000) } } : {}),
  });
}
