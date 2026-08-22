# GH-26 architect pass — 2026-08-10

## Scope

Received from cleaner as `merge_and_process cleaner 16145b5b66` (cleaner
forwarded coder's commit unchanged — clean pass, no cleanup needed).

Delta reviewed (`git show --stat 16145b5b66`):
- `extension/src/tools/telegram-front-desk-bot.ts`
- `extension/src/tools/telegramFrontDeskBotCore.ts`
- `extension/test/telegramFrontDeskBotCli.test.js`
- `extension/test/telegramFrontDeskBotCore.property.test.js`
- `extension/test/telegramFrontDeskBotCore.test.js`
- `specs/features/GH-26-undeliverable-role-question-clears-marker.feature`
  (promoted from `.feature.draft`)
- `specs/pipeline/steps/gh26RoleQuestionUndeliverableClearsMarkerSteps.js`
  (new) + `specs/pipeline/steps/index.js` (registration)
- `swarmforge/scripts/operator_lib.bb`
- `swarmforge/scripts/operator_runtime.bb`
- `swarmforge/scripts/role_ask.bb`
- `swarmforge/scripts/test/operator_lib_test_runner.bb`
- `swarmforge/scripts/test/test_operator_runtime_tick.sh`
- `swarmforge/scripts/test/test_role_ask.sh`

## Checks run (complete inventory, not first-failure-stop)

1. **Declared invariant (1, ticket YAML)** — "No undeliverable role question
   leaves its role wedged: after any drop, the awaiting-marker state permits
   asking again immediately, and the drop is surfaced in status.json." Three
   sub-claims, all covered by non-vacuous tests before any hand-verification:
   - TS-side rewrite (`deliverRoleQuestion` calls
     `markRoleQuestionUndeliverable` before `ackReply`) —
     `telegramFrontDeskBotCore.property.test.js`'s new fast-check property
     (200 runs, both mapped/unmapped and options/no-options branches forced
     by construction). Comment states it was confirmed to fail on the
     unmapped case when the fix line is removed, then restored.
   - Guard treats `state: undeliverable` as NOT pending —
     `operator_lib_test_runner.bb`'s 5 new `role-ask-blocked?` assertions
     (nil, ordinary pending, undeliverable, corrupt `{}`, other-state) +
     `test_role_ask.sh`'s 2 new end-to-end CLI cases (undeliverable-state
     marker unblocks and is overwritten; ordinary marker still blocks).
   - Surfaced in status.json — `test_operator_runtime_tick.sh`'s 3 new
     `--tick-once` fixture cases (undeliverable surfaced, ordinary pending
     omitted, no role-awaiting dir at all omits the key entirely).
   All three ran, none were vacuous (see test run results below). PASS.
2. **Correctness read of the fix** — matches the ticket's approval_context
   choices exactly: marker is rewritten (`{question, options, ...existing,
   state: 'undeliverable'}` — spread order means `existing`'s own
   question/options win when a marker file is present, the passed params
   are only the fallback when none exists, matching the "forensics
   preserved" comment), never deleted; `role-ask-blocked?` exempts only the
   literal `"undeliverable"` state and fails closed on any other/missing
   state; scope correctly limited to `telegramFrontDeskBotCore.ts` (the
   verified live path per approval_context choice 3, not the
   issue-text-named `bridge/` path). No defect found.
3. **Dependency-rule gate (BL-259 hard gate)** — `node
   extension/out/tools/dependency-gate.js src/tools/telegram-front-desk-bot.ts
   src/tools/telegramFrontDeskBotCore.ts` (Node 22.23.2, satisfies
   dependency-cruiser's engine requirement) reports 3 `acyclic` violations
   among `telegram-front-desk-bot.ts` / `telegramCursorOperatorExec.ts` /
   `telegramCursorOperatorLiveness.ts`. Isolated the source: running the
   gate against `telegramFrontDeskBotCore.ts` alone PASSES; against
   `telegram-front-desk-bot.ts` alone reproduces all 3 edges — the cycle is
   entirely pre-existing lazy `await import(...)` calls at
   `telegram-front-desk-bot.ts:2157,2162`. Diffed those exact lines against
   `16145b5b66^` (the cleaner's parent): byte-identical, GH-26's 27-line
   delta to this file is the `markRoleQuestionUndeliverable` export/wiring
   only, nowhere near the cyclic imports. This is BL-759
   (`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`,
   `status: todo`), which names this exact scenario verbatim: "The next
   parcel that touches any of these three files fails the architect's hard
   gate on an edge it did not introduce... a wasted round-trip charged to
   an innocent ticket." Same disposition as the BL-848 architect pass
   precedent (`backlog/evidence/BL-848-architect-pass-20260808.md` §3):
   pre-existing drift, already ticketed, out of this ticket's scope, not a
   blocker here (surfacing only).
4. **Co-change coupling (BL-255)** — `co-change-report.js` on both changed
   TS files: no co-changers found for either (below the tool's default
   frequency/group-size thresholds). No suspicious coupling.
5. **Two-layer boundary / host-IO-ownership / webview-storage / secrets** —
   all changes are extension-host TypeScript (`extension/src/tools/`) and
   swarm-substrate Babashka scripts (`swarmforge/scripts/`, a maintained
   fork per Local Engineering Architecture Rule 2 — modifying it directly is
   the normal mechanism, not a fork violation). No webview file touched, no
   browser storage, no secrets.
6. **Scope discipline (BL-506)** — `git show --stat 16145b5b66` matches the
   file list above exactly; no ticket-less files folded in.
7. **Property Testing pass (separate from invariant #1)** — the invariant's
   own property test already covers the one pure, property-shaped boundary
   this delta touches (`deliverRoleQuestion`'s undeliverable branch).
   `operator_lib.bb`'s `role-ask-blocked?` and
   `render-role-questions-undeliverable` are pure but Babashka has no
   property-testing framework wired (fast-check is JS-only per engineering
   rules) — covered instead by exhaustive example-based cases across all
   marker-state combinations (5 for the guard, forensics/fallback/malformed
   cases for the rewrite). No additional undercovered pure module found; no
   new property test needed beyond what already landed.
8. **Untracked `swarmforge/scripts/operator_path_lib.sh`** in this
   worktree — pre-existing known debt (BL-796 per coder's prior status),
   not part of this parcel's diff, left untouched, not staged.
9. **Full related suite run** (all green):
   - `npm run compile` (extension) — clean
   - `vitest run test/telegramFrontDeskBotCore.test.js
     test/telegramFrontDeskBotCli.test.js` — 620/620 PASS
   - `npm run test:properties -- test/telegramFrontDeskBotCore.property.test.js`
     — 8/8 PASS
   - `swarmforge/scripts/test/test_role_ask.sh` — ALL PASS (incl. both new
     GH-26 cases)
   - `bb swarmforge/scripts/test/operator_lib_test_runner.bb` — ALL TESTS
     PASSED
   - `swarmforge/scripts/test/test_operator_runtime_tick.sh` — all 3 new
     GH-26 assertions `ok`; one PRE-EXISTING unrelated failure further down
     the same file (`swarm-seed-race-01`, from BL-310, `touch -d "-5
     minutes"` — BSD `touch` on macOS rejects GNU-style relative-date
     syntax). Confirmed pre-existing: identical `touch -d` line present
     verbatim at `16145b5b66^`, and GH-26's diff to this file is a
     pure 27-line addition (its own 3 assertions), touching nothing above
     the seed-race test. Unticketed — sending a `note` to specifier per the
     same "please ticket" pattern BL-759 itself originated from.

## Verdict

NONE — no architecture violation, no invariant violation, no correctness
defect found in this parcel. Two pre-existing, out-of-scope items surfaced
(BL-759, already ticketed; macOS `touch -d` incompatibility in
`swarm-seed-race-01`, newly surfaced via `note` to specifier). Forwarding
to hardener.
