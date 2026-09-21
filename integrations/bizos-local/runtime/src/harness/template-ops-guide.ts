import type { TemplateNote } from "./company-os.js";

// One command protocol for every template that installs the Ops helper.
const GUIDE: TemplateNote = {
  path: "scripts/README.md",
  text: `# Vault-local operations script

Run with Node.js 22 or newer from any current directory:

\`node scripts/ops.mjs <command>\`

When called from elsewhere, pass the installed script path. The script resolves the vault from its own file location, including paths with spaces. It uses only Node built-ins, performs no network, Git, model, connector or background action, and reads/writes only vault-local state. It rejects path traversal, symlink targets, root escape, corrupt JSON/JSONL and stale revision writes. State updates use atomic replacement under a roughly two-second interprocess lock wait. Locks are never stolen by age; timeout preserves the lock and prints the manual orphan-recovery check. Cleanup removes only a safe lock whose owner token still matches.

## Bootstrap and integrity

- \`node scripts/ops.mjs bootstrap\`
- \`node scripts/ops.mjs check\`

## Claims

- \`node scripts/ops.mjs claim take --scope "feature/search" --owner product --run run-1\`
- \`node scripts/ops.mjs claim set --id <claim-id> --status IN-PROGRESS --owner product --run run-1\`
- \`node scripts/ops.mjs claim list\`
- Release: status \`RELEASED\`; only a released normalized scope can be reclaimed.
- Close: status \`DONE\` plus \`--proof reports/proofs/<verification.json>\`; the report must be accepted and match the latest PASSED run log for the same claim, owner and run.

## Decisions and approval requests

- \`node scripts/ops.mjs decision set --subject "ship search" --value GO --status DECIDED --by owner --expected-revision 0\`
- \`node scripts/ops.mjs decision show --subject "ship search"\`
- \`node scripts/ops.mjs decision list\`
- \`node scripts/ops.mjs approval ask --agent product --priority P2 --title "Choose launch" --context "Two shapes are ready" --proposal "Use the smaller shape" --option small --option large --default small --recipient owner --expires-at 2030-01-01T00:00:00.000Z --run run-2\`

Decision writes use compare-and-swap: pass the current revision, or 0 to create. Expiration is displayed but never becomes approval. Decisions are data; they do not execute instructions or grant dangerous authority.

## Inbox memos

- \`node scripts/ops.mjs inbox send --id msg-1 --to cto --from product --subject "Review" --body "Render a verdict" --run run-2\`
- \`node scripts/ops.mjs inbox list --to cto\`
- \`node scripts/ops.mjs inbox ack --to cto --id msg-1 --by cto\`

IDs are unique across active and archived messages. Ack moves a message to \`done/\`. A memo remains awaiting the next sweep and does not wake a model; use the runtime's real team-group @Name handoff for immediate delivery.

## Proof and run log

- Store useful arbitrary artifacts separately under \`reports/proofs/\`. Create a JSON verification report with exactly this contract: \`version: 1\`; \`outcome\` equal to \`accepted\`, \`rejected\` or \`pending\`; coherent boolean \`accepted\` (true only for outcome accepted); a nonempty \`summary\`; and one or more \`artifacts\` entries containing a vault-relative \`path\` under \`reports/proofs/\` plus the artifact's lowercase SHA-256. The report cannot reference itself. Missing files, duplicate paths, changed hashes, empty artifacts and incoherent fields fail validation.
- \`node scripts/ops.mjs proof check --path reports/proofs/search-verification.json\`
- \`node scripts/ops.mjs run log --claim <claim-id> --agent product --run run-2 --trigger "owner GO" --actions "researched; tested; reviewed" --outcome passed --result "tests and review accepted" --evidence reports/proofs/search-verification.json --cost unknown --next "close claim"\`

Run outcome is exactly \`passed\`, \`failed\` or \`incomplete\` and must respectively use an accepted, rejected or pending verification report. \`result\` remains the observed narrative. Cost is exactly \`unknown\` or starts with \`known:\` and includes the observed value/unit. DONE revalidates artifact hashes and requires the latest matching run to be PASSED, so an earlier success cannot hide a later failure. Arbitrary \`passed:true\` cannot close work.

## Knowledge

- New subject: \`node scripts/ops.mjs knowledge propose --draft knowledge/draft/product/search.md --target knowledge/trusted/product/search.md --owner product --last-reviewed 2026-09-21 --by product --expected-revision 0\`
- After rejection and an edited canonical draft: \`node scripts/ops.mjs knowledge propose --draft knowledge/draft/product/search.md --target knowledge/trusted/product/search.md --owner product --last-reviewed 2026-09-21 --by product --expected-revision 2\`
- Omitting \`--expected-revision\` defaults to 0 and is valid only for a new subject.
- Record an explicit \`APPROVE\` decision on the returned subject with expected revision 1.
- \`node scripts/ops.mjs knowledge promote --draft knowledge/draft/product/search.md --target knowledge/trusted/product/search.md --owner product --last-reviewed 2026-09-21 --decision-subject <returned-subject> --decision-revision 2\`
- For the rejection/reproposal example: \`node scripts/ops.mjs decision set --subject <returned-subject> --value APPROVE --status DECIDED --by owner --expected-revision 3\`, then run the same promote command with \`--decision-revision 4\`.
`,
};

export function operationsGuide(owner: string, reviewer: string): TemplateNote {
  return { ...GUIDE, text: GUIDE.text.replaceAll(/\bproduct\b/g, owner).replaceAll(/\bcto\b/g, reviewer) };
}
