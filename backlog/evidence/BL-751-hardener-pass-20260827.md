# BL-751 — hardener pass — 20260827

## Inbound — commit substitution (environment corruption, not a fix)

Received `git_handoff` from architect naming commit `7ba98cb150`. That
commit is corrupted: its first parent `478cfc514` sits on a disjoint
`init`/`seed`/`fixture: initial` commit chain — a 7-file near-empty tree
(`backlog/evidence/BL-1124-...md`, `extension/src/a.ts`, `src/thing.ts`,
`telegramCursorBridgePilot.ts`+test, `hardender.prompt`,
`swarmforge.conf`), not real project history (HEAD has 9732 files).
Merging it as instructed would have deleted ~9700 real files (confirmed via
`git merge --no-ff` dry run before aborting).

This is a fresh instance of the ambient `GIT_DIR`/`GIT_WORK_TREE`
fixture-leak class (BL-1124), striking the **architect's own worktree**
this time. My own session env was verified clean (`env | grep '^GIT_'`)
before merging — the corruption is baked into the commit object itself, not
my session.

`7ba98cb150`'s second parent, `20edfe53a` (cleaner's merge of coder's
`a920c717d`), is the real, well-formed BL-751 work: ancestor-sane against
my HEAD (shares `80c0537c2` BL-1184 lineage), merges with zero conflicts.
The coder's own commit message on `a920c717d` independently documents
hitting this same ambient-GIT_DIR canary via the pre-commit property-suite
guard, with its own root-cause doc
(`backlog/evidence/BL-1124-property-fixture-git-env-leak-20260827.md`).

**Merged `20edfe53a` instead of `7ba98cb150`.** Commit: `3eaf6ebc7`.

## What BL-751 actually changed

`extension/src/tools/telegramCursorBridgePilot.ts`: added one literal text
block to `composePilotExpeditorPrompt`'s returned array (REVIEW HATS —
BL-751, ~7 lines) plus two JSDoc comment lines. No branching logic added —
`composePilotExpeditorPrompt` remains a single `return [...].join('\n')`,
cyclomatic complexity 1. Mirrored change to
`swarmforge/roles/hardender.prompt` (this role's own prompt — process doc,
not code).

## Gates

| Gate | Result |
|---|---|
| Compile | PASS |
| Unit `telegramCursorBridgePilot.test.js` | 21/21 PASS (`node --test`) |
| Mutation cooldown gate (`mutation_cooldown_gate.bb`) | **skip-cooldown** (file_age 1.43d < 3d) — skipped unconditionally per Hardening Order |
| CRAP (tool) | **not computed by standard tool** — see below |
| CRAP (manual) | trivially safe — see below |
| DRY (`jscpd`, scoped to file) | 0 clones, 0% duplication |
| Acceptance | N/A — ticket has no `acceptance:` feature file |
| Property tests | N/A — none for this file |

## CRAP tool gap (not a BL-751 defect, recorded per degraded-fallback discipline)

`npm run crap:lets-talk-cursor-bridge` failed to produce a coverage report:
`telegramCursorBridgePilot.test.js` is one of 38 remaining test files still
using `require('node:test')` directly (pre-BL-124 migration), so Vitest's
collector reports "No test suite found" for it and never instruments its
coverage — vitest's coverage-final.json can never reflect this file's real
test coverage regardless of how thorough those tests are. This is a
pre-existing, repo-wide gap (38 files), not something to fix under BL-751's
scope (a "pilot severity asymmetry" ticket touching 3 files).

Manual CRAP: `composePilotExpeditorPrompt` and the two touched JSDoc lines
add zero branches (CC=1 before and after this diff). CRAP = CC + CC³×(1-cov)³;
at CC=1, CRAP ≤ 2 even at 0% measured coverage — well under the CRAP ≤ 6
gate regardless of the tool's blind spot. Real coverage is thorough: the
new text block is protected by BOTH the exhaustive golden `assert.equal`
test (`composePilotExpeditorPrompt is the full offline-expeditor brief`,
line 41) covering the ENTIRE composed string byte-for-byte, and a dedicated
regex-assertion test naming BL-751 explicitly (line 278). Any StringLiteral
mutation to the new block would be caught by the golden test.

## Unrelated pre-existing red found during the coverage run (out of scope, flagged separately)

`coverage:lets-talk-cursor-bridge`'s broader vitest run (unrelated files in
the same glob) surfaced 2 pre-existing failures in
`telegramCursorBridgeCore.test.js` (`formatHelpMessage` missing
`/redeploy frontdesk` and `/redeploy all` lines — BL-710 shipped these verbs
without updating the static help text) and 1 in
`telegramCursorBridgeCli.test.js` (boot-prompt exit code). Confirmed via
`git diff 803b4f038..HEAD` that neither file was touched by my merge, and
via `origin/main` (43 commits ahead of local `main`) that the defect is
still live upstream. Grepped `backlog/` for the failing test/assertion
names — not found ticketed. Reported by `note` to specifier + coordinator,
not fixed here (out of BL-751's scope, different files).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-751-bl646-pilot-missed-severity-asymmetry`, commit (this pass's tip).

By hardender.
