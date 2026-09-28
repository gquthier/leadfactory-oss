import { describe, expect, it } from "vitest";
import { creationTemplateOf, CREATION_TEMPLATE_IDS, summarize, templateOf } from "../src/harness/templates.js";
import type { Storage } from "../src/harness/storage.js";

describe("new company operating context", () => {
  it("gives Company OS a direct custom recruitment path when it has no prepared specialists", () => {
    const created = creationTemplateOf(templateOf("company-os"));
    expect(created.notes.some((note) => note.path.endsWith("/role.json"))).toBe(false);
    const instructions = [created.bots[0]!.instructions, ...[
      "AGENTS.md", "Team.md", "Agents/TEAM.md", "Agents/CEO/system.md", "Roles/README.md",
    ].map((path) => created.notes.find((note) => note.path === path)!.text)];
    for (const text of instructions) {
      expect(text).toContain("name, title, description, context and initial_task");
      expect(text).toContain("without role_slug");
      expect(text).not.toContain("with the closest role_slug");
    }
    expect(created.notes.find((note) => note.path === "Roles/README.md")!.text).toContain("No prepared specialist blueprints");
    expect(created.bots[0]!.instructions).toContain("already-authorized mission");
    expect(created.notes.find((note) => note.path === "Team.md")!.text).toContain("STOP limits");
  });

  it.each(["lead-gen-agency", "service-based-business", "software"] as const)("keeps %s recruitment tied to its prepared role blueprints", (id) => {
    const created = creationTemplateOf(templateOf(id));
    expect(created.notes.some((note) => note.path.endsWith("/role.json"))).toBe(true);
    expect(created.bots[0]!.instructions).toContain("with the closest role_slug");
    expect(created.notes.find((note) => note.path === "Roles/README.md")!.text).toContain("use recruit_agent with role_slug");
  });

  it.each(CREATION_TEMPLATE_IDS)("keeps %s sources intact while describing a real one-CEO bootstrap", (id) => {
    const source = templateOf(id);
    const original = JSON.stringify(source);
    const created = creationTemplateOf(source);
    expect(JSON.stringify(source)).toBe(original);
    expect(created.bots.map((bot) => bot.name)).toEqual(["CEO"]);
    expect(created.team).toBeUndefined();
    const textAt = (path: string) => created.notes.find((note) => note.path === path)?.text;
    expect(textAt("Agents/TEAM.md")).toContain("Only CEO is active");
    expect(textAt("Team.md")).toContain("no team group");
    expect(textAt("AGENTS.md")).toContain("From the CEO DM, use recruit_agent");
    expect(created.bots[0]!.instructions.length).toBeLessThan(6000);
    expect(created.bots[0]!.instructions).toContain("system.md");
    expect(textAt("Agents/CEO/system.md")).toContain("initial_task");
    expect(textAt("Agents/CEO/source.md")).toContain(source.bots[0]!.instructions.trim());
    const current = created.notes.filter((note) => !note.path.endsWith("/source.md")).map((note) => note.text).join("\n");
    for (const stale of [
      "installer creates these six agents", "eleven persistent software-company agents",
      "Verify the eleven persistent agents", "six roster entries are persistent",
      "tell the user to open the team chat", "DMs do not dispatch.",
      "A DM does not dispatch another agent.", "preinstalled group",
      "Coordinate a teammate only in a team chat", "Service Business Team",
    ]) expect(current, stale).not.toContain(stale);
    for (const role of source.bots.slice(1)) {
      expect(textAt(`Roles/${role.slug}/source.md`)).toContain(role.instructions.trim());
      expect(textAt(`Roles/${role.slug}/system.md`)!.length).toBeGreaterThan(100);
      expect(Buffer.byteLength(textAt(`Roles/${role.slug}/system.md`)!, "utf8")).toBeLessThanOrEqual(15_000);
      expect(textAt("Roles/README.md")).toContain(role.slug);
      expect(textAt(`Roles/${role.slug}/system.md`)).not.toContain(`then \`${role.name}.md\``);
      expect(textAt(`Roles/${role.slug}/system.md`)).not.toContain("then your named role sheet");
      expect(created.folders).not.toContain(`Agents/${role.name}`);
    }
    if (id === "software") {
      expect(textAt("Roles/README.md")).toContain("Backend engineer");
      expect(textAt("Roles/README.md")).toContain("Required proof");
      expect(textAt("Roles/source.md")).toContain("## Recruitable specialists");
    }
    const summary = summarize({} as Storage, source, null, []);
    expect(summary.notes).toBe(created.notes.length);
    expect(summary.folders).toBe(created.folders.length);
  });
});
