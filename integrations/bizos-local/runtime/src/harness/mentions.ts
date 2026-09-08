import type { Bot } from "./types.js";

/** Case AND accent blind, because a name is not a password.
 *
 * "@Vega" has to wake a teammate called "Véga" — the writer types what they
 * hear, and an app that answers only the exact glyphs answers nobody. NFD
 * splits "é" into "e" + the combining accent; dropping the marks leaves a
 * string the same length as the original for every precomposed Latin letter,
 * which is what lets the offsets below stay comparable.
 *
 * Mirrored, deliberately, by `foldForMention` in `src/lib/localbizos/mentions.ts`:
 * the shell decides which chip to draw and the runtime decides who answers, and
 * they must not disagree about what "@Ops" means. */
export function foldForMention(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** A mention is a WORD. Anything that can be part of one — a letter in any
 * script, a digit, `_`, `-` — ends it on either side. Without the left-hand
 * half of this rule `ecris a gauthier@ops.com` woke Ops, and without a
 * Unicode-aware right-hand half `@Opsé` did too: `[a-z0-9_-]` does not know
 * that `é` is a letter. */
const WORDLIKE = /[\p{L}\p{N}_-]/u;

/** `@Name` — letters, digits, `_`, `-`, `.` and spaces inside a bot's
 * display name are matched by comparing against the roster rather than by
 * guessing at a token boundary, so "@Ads Manager" resolves. */
export function findMentionedBotIds(text: string, roster: Bot[]): string[] {
  if (!text.includes("@")) return [];
  const folded = foldForMention(text);
  const hits: Array<{ id: string; at: number; length: number }> = [];
  for (const bot of roster) {
    const name = bot.name.trim();
    if (!name) continue;
    const needle = `@${foldForMention(name)}`;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(needle, from);
      if (at === -1) break;
      from = at + needle.length;
      const before = at > 0 ? folded.charAt(at - 1) : "";
      const after = folded.charAt(at + needle.length);
      if (before && WORDLIKE.test(before)) continue;
      // A longer name wins: "@Ads" must not swallow "@Ads Manager".
      if (!after || !WORDLIKE.test(after)) hits.push({ id: bot.id, at, length: needle.length });
    }
  }
  hits.sort((a, b) => a.at - b.at || b.length - a.length);
  const claimed: Array<[number, number]> = [];
  const ordered: string[] = [];
  for (const hit of hits) {
    const overlaps = claimed.some(([start, end]) => hit.at < end && hit.at + hit.length > start);
    if (overlaps) continue;
    claimed.push([hit.at, hit.at + hit.length]);
    if (!ordered.includes(hit.id)) ordered.push(hit.id);
  }
  return ordered;
}

/** Who answers a message posted to a group.
 *
 * With mentions: exactly those members, in the order they were mentioned.
 * Without: every member, in roster order — a group question is asked of the
 * whole group, and silently picking one member would be a lie about who
 * was consulted. `exclude` keeps a bot from replying to itself. */
export function resolveGroupTargets(input: {
  text: string;
  memberIds: string[];
  roster: Bot[];
  explicitMentionIds?: string[];
  exclude?: string;
}): string[] {
  const members = new Set(input.memberIds);
  const mentioned = [
    ...(input.explicitMentionIds ?? []),
    ...findMentionedBotIds(input.text, input.roster.filter((bot) => members.has(bot.id))),
  ];
  const unique = [...new Set(mentioned)].filter((id) => members.has(id));
  const targets = unique.length ? unique : input.memberIds.filter((id) => members.has(id));
  return targets.filter((id) => id !== input.exclude);
}
