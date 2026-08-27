# BL-592 architect bounce — 2026-08-27

## Reviewed commit

`3cd8e6c173` (cleaner merge of coder `e5cf2a3af4` for
BL-592-spec-tree-on-live-console-with-epic-tier), merged into architect at
`d4820ef4e`.

## Passed checks

- `node extension/out/tools/dependency-gate.js` (scoped to the 4 changed
  `.ts` files, and full-repo) — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js` — coupling signal matches
  the diff's own footprint (`bridgeServer.ts`, `consoleMenuUiHtml.ts`,
  `pwa/app.js`, `specs/pipeline/steps/index.js`, docsTree tests); nothing
  unexpected.
- No `invariants:` declared on the ticket YAML — no property-test-existence
  gate applies.
- Property test `extension/test/bl592SpecTreeEpicTierInvariants.property.test.js`
  — verified NON-VACUOUS by hand: broke `buildEpicNodes` (duplicated a
  ticket into a second epic bucket), recompiled, reran — both tests
  correctly failed; restored, recompiled, reran — both pass again.
- `extension/test/docsTree.test.js`, `pwaDocsExplorer.test.js`,
  `pwaLocale.test.js` — 98/98 passing.
- Two-layer boundary, host-owns-I/O, webview-presentation-only,
  no-webview-storage, secrets-stay-host-side, read-only gate, schema-version
  bump with PWA back-compat (`milestoneEpics`/`milestoneTicketCount`/
  `milestoneAllTickets` fallback in `pwa/app.js`) — all verified compliant
  by reading the diff directly.
- Cross-milestone-epic modelling choice (Delta 2's flagged non-obvious
  decision) is pinned by an explicit scenario
  (`BL-592 cross-milestone-epic-modelling-05`), not left to grouping-code
  accident, and the code matches the scenario (epic node appears under
  every milestone its members touch, ticket list per-milestone-filtered).

## D1 — fixture-dir and bridge-handle leak in the new acceptance step file

**File:** `specs/pipeline/steps/bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js`
**Class:** behavior (resource-hygiene correctness defect, not architecture)
**Blamed role:** coder (author of this new file)

`mkFixture()` creates a fresh `fs.mkdtempSync` fixture directory per
scenario (via the `Background` step handler, so all 8 scenarios pay for it
even the 5 that never touch the bridge) and copies all 251
`swarmforge/scripts/*.bb` files into it. Nothing in the file ever removes
`ctx.root` — no `afterEach`, no `registry.after`, no `finally`. Likewise,
`ctx.bridgeHandle` is only stopped by specific `Then` steps
(`stopBridge(ctx)` calls inside "the tree data is served fresh…", "the
tracker ticket is not listed again…", "no affordance exists…") — a throw in
an earlier step of the same scenario (e.g. `renderSpecTreeScreen`'s
`assert.equal(res.status, 200)` or a `waitFor` failure) leaks both the
fixture dir and the still-listening bridge server, uncleaned.

**Directly observed, not theoretical:** running
`node specs/pipeline/cli.js specs/features/BL-592-spec-tree-on-live-console-with-epic-tier.feature`
myself left **84 leaked `/tmp/sfvc-bl592-*` directories** (~535-547 files
each, ~45,000+ files total) after a single run, and the run itself stalled
for 5+ minutes at 0% CPU (I/O-bound) — consistent with the accumulating
leaked-file volume degrading filesystem operations for every subsequent
`git add -A` in the same run (this WSL2 host is known-slow for many-small-
file I/O). I killed the run and removed the 84 dirs myself as my own
session's scratch output (not touching the unrelated, still-running
acceptance process I separately observed in `.worktrees/coder`, which is
not mine to touch).

This is exactly the class of defect `engineering.prompt`'s Test Speed And
Isolation rule (BL-971) exists to stop: *"A fixture dir from
`fs.mkdtempSync` is removed in a `finally`, never only after the last
assertion — a throw or bounce otherwise leaks it forever."* The sibling
file this ticket explicitly says it mirrors
(`specs/pipeline/steps/bl674EpicDrilldownUiSteps.js`) has the **same** gap
(inherited, not new to bl674 either) — so this is not a novel mistake, but
copying a known-bad shape into a brand-new file is still a defect in code
authored for THIS ticket, and the established correct idiom already exists
elsewhere in the same directory to copy instead: see
`cleanupFixture(ctx)` in
`specs/pipeline/steps/bl1048DeliveredParcelIsNotNotStartedSteps.js`
(`fs.rmSync(ctx.root, { recursive: true, force: true })`, wired via
`afterEach` so it runs even when an earlier step throws before the
`When`/`Then` step's own cleanup would fire — the exact cross-step leak
shape this file is also exposed to via `ctx.bridgeHandle`).

**Remediation:** add an `afterEach` (or `registry.after`, whichever this
registry supports — `bl1048DeliveredParcelIsNotNotStartedSteps.js` uses
`require('node:test').afterEach`) that unconditionally: stops
`ctx.bridgeHandle` if set, then `fs.rmSync(ctx.root, { recursive: true,
force: true })` if `ctx.root` is set. Safe to leave the existing manual
`stopBridge(ctx)` calls in place (idempotent no-op once already stopped).

## Forward

Bounced to **coder**, task name carries a one-line summary. Not forwarded
to hardener.
