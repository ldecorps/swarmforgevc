# Architect pass — BL-722, BL-852, BL-847, BL-853 (2026-08-08)

## Context

Received from cleaner as a single batch commit (3ee40328ee, cleaner pass
evidence, no defects) covering four independently-implemented tickets:
BL-722 (`/pilot safe`), BL-852 (chase-sweep ambulance hold), BL-847
(resource sampler measures the agent, not the pane shell), BL-853
(promotion path honours the no-limit depth sentinel). Isolated the four
tickets' own diff from inherited ancestor history via
`d66fc073 (pre-BL-722 promote) .. 8871cfa4 (BL-853 tip)`, matching the
cleaner's own review scope.

## Dependency-rule gate (BL-259 REQUIRED HARD GATE)

Node 20.20.2 (this host's default) cannot run `dependency-cruiser`
(`^22||^24||>=26` required) — same pre-existing environmental gap the
cleaner's evidence already flagged. Switched to Node 22.23.2 via `nvm` and
ran the real gate rather than recording it as blocked:

    node extension/out/tools/dependency-gate.js src/metrics/resourceTelemetry.ts \
      src/swarm/resourceSamplerActivation.ts src/tools/telegramCursorBridgeCore.ts \
      src/tools/telegramCursorBridgeLive.ts

Result: FAILED on three `acyclic` edges (`telegram-front-desk-bot.ts` <->
`telegramCursorOperatorExec.ts`/`telegramCursorOperatorLiveness.ts`). None
of the three files is touched by this parcel's diff — depcruise reports it
because `telegramCursorBridgeCore.ts` is reachable in the same connected
component. Verified this is the **pre-existing** BL-759 cycle, not
something this parcel introduced: checked out the pre-parcel commit
(4196438d) into an isolated worktree with a symlinked `node_modules`,
compiled it, and ran the full-repo gate — identical three-edge failure.
BL-759 (`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`,
severity medium, assigned specifier) already documents this exact cycle and
explicitly anticipates it resurfacing on any parcel that merely touches a
file reachable from it ("The next parcel that touches any of these three
files fails the architect's hard gate on an edge it did not introduce").
Not a bounce for this parcel — same precedent BL-759 itself records from
the BL-723 pilot review.

Full-repo scan at current HEAD: same three edges only, nothing new.

## Co-change coupling (BL-255, informational)

Ran `co-change-report.js` over all eight changed source files. Only
expected hub coupling: `telegramCursorBridgeCore.ts` <->
`telegramCursorBridgeLive.ts` (12, both part of the same bridge dispatch
pair) and `chase_sweep_lib.bb` <-> `handoffd.bb` (13, both daemon
scheduling components). No new or suspicious logical coupling outside the
files each ticket's own scope names.

## Architecture review

- **BL-847** (`resourceSamplerActivation.ts`): extension-host code shelling
  to `ps` (read-only process listing) — same I/O category as the existing
  tmux shell-outs, no boundary crossing. `resolveAgentPid` composes
  `resolvePanePid` + `selectAgentDescendant` (pure BFS over an injected
  process table), never falls back to the shell pid. Confirmed the existing
  `getPid() === null` skip path in `resourceTelemetry.ts:203-205` already
  honors "no sample rather than wrong sample" (invariant 2) — no new
  fallback introduced.
- **BL-722** (`pilotSafeDefects.ts`, bridge wiring): extension-host fs I/O
  (owns disk reads, consistent with every other `extension/src/tools/`
  module); no webview code touched, no browser storage, no secrets. All
  four `required_wiring` entries present and wired
  (`listSafePilotDefects`, `parsePilotSafeCommand`, `decideOperatorCommand`
  dispatch, `INBOUND_ACTION_HANDLERS` list/start handlers).
- **BL-852** (`chase_sweep_lib.bb`): reuses the shared
  `handoff-lib/default-ambulance-held?` predicate (no second notion of
  held, invariant 3) via a new `item-ambulance-held?` wrapper; `held?`
  routes through `decide-item-action`'s new cond branch straight to
  `apply-inbox-item-action!`'s `case` fallthrough (`nil` — no write, no
  wake), confirmed by reading the case form directly. `required_wiring`
  satisfied.
- **BL-853** (`promotion_gates_lib.bb`, `promote_and_route_next.sh`,
  `backlog_depth_conf_path_cli.bb`): `depth-refusal` now consults
  `backlog-depth-lib/no-limit?` before comparing (invariant 1); the shell
  now accepts a signed cap and resolves the fallback CLI's config-file-path
  argument correctly (both `required_wiring` entries satisfied). One
  observation, not a defect: the shell's absolute-last-resort literal
  (`CAP=5`, reached only if all three `bb` invocations fail outright, i.e.
  `bb` itself is unusable) is a disclosed value mirroring
  `backlog-depth-lib/default-max-depth` rather than a call into the
  library — a literal reading of invariant 2 ("declares no depth default
  of its own") would flag it, but in the one scenario where it fires, `bb`
  cannot be shelled to at all, so no code path could query the library
  either; this is the best achievable degrade, not an oversight, and it is
  explicitly commented as such. Noting it rather than treating it as a
  send-back.

## Invariants review (BL-633/BL-654)

All eleven declared invariants across the four tickets (BL-722: 3, BL-852:
3, BL-847: 2, BL-853: 3, one of BL-853's three explicitly
non-property-encodable) have either a live property test or a stated
non-encodability reason, verified by reading the test source directly
rather than trusting the file's own claim:

- BL-722: `pilotSafeDefects.property.test.js` — invariants 1-3, all
  non-vacuous.
- BL-847: `resourceSamplerActivation.property.test.js` — invariants 1-2,
  both non-vacuous.
- BL-852: `bl852_chase_sweep_ambulance_hold_property_runner.bb` —
  invariants 1 and 3 (the two with a pure-function shape); invariant 2
  ("the mute is narrow") is scenario-covered in the Gherkin feature per its
  own notes.
- BL-853: `promotion_gates_lib_property_runner.bb` P5/P6 — invariants 1 and
  3, both with an independent pre-fix oracle (not calling the function back
  into itself), non-vacuous. Invariant 2 is explicitly recorded as a
  structural/prose fact about the shell script rather than a pure
  input/output relationship — a stated non-encodability reason, not a
  missing test.

No missing or vacuous property test found.

## Verification run (independently re-run, not just trusting cleaner's log)

- `npm run compile` (extension/) — clean.
- `npx vitest run test/resourceSamplerActivation.test.js
  test/sampleResourcesCli.test.js test/telegramCursorBridgeCore.test.js
  test/telegramCursorBridgeLive.test.js test/resourceTelemetry.test.js` —
  292/292 passed.
- `npx vitest run --config vitest.properties.config.mjs
  test/resourceSamplerActivation.property.test.js
  test/pilotSafeDefects.property.test.js` — 12/12 passed.
- `bash swarmforge/scripts/test/test_chase_sweep.sh` — ALL PASS (20 cases).
- `bb swarmforge/scripts/test/bl852_chase_sweep_ambulance_hold_property_runner.bb`
  — ALL PROPERTIES HOLD (300 runs/invariant), non-vacuity confirmed inline.
- `bash swarmforge/scripts/test/test_promote_and_route_next_no_limit_depth.sh`
  — PASS.
- `bash swarmforge/scripts/test/test_backlog_depth_conf_path_cli.sh` —
  PASS.
- `bash swarmforge/scripts/test/test_promote_and_route_next_priority.sh` —
  PASS.
- `bb swarmforge/scripts/test/promotion_gates_lib_property_runner.bb` — ALL
  PROPERTIES HOLD (500 runs, P1-P6).
- Gherkin acceptance, all four features via `specs/pipeline/cli.js`: BL-722
  4/4, BL-847 4/4, BL-852 11/11, BL-853 11/11 — all scenarios executed (not
  skipped), all passed.

## Minor observation (not a defect, no bounce)

`backlog/active/BL-852-chase-sweep-respects-ambulance-hold.yaml`'s own
`acceptance:` field still reads
`specs/features/BL-852-chase-sweep-respects-ambulance-hold.feature.draft`,
but the coder promoted the real file to `.feature` (present, non-draft, in
`specs/features/`) as its own ticket text instructs. Harmless today:
`pilotSafeDefects.ts`'s `featureExists()` falls back to a directory scan
that finds the promoted file regardless of the stale acceptance-field
suffix, and independently verified BL-852 does not appear in `/pilot safe`'s
candidate pool via this path in either case (`type: defect`+`status: todo`,
not `paused`, so it is excluded by folder scope regardless). Flagging for
whichever role next touches this ticket's YAML rather than bouncing a
clean, fully-verified parcel for a cosmetic metadata mismatch.

## Verdict

NONE — no defects found across all four tickets. Forwarding to hardener.
