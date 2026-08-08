# Architect pass — BL-846, BL-722 (2026-08-08)

## Context

Received two separate `git_handoff`s from cleaner (Article 2.6 batch
splitting, correctly applied), both pointing at the same commit
`3c9fc5b1e5`:
- BL-846 (task `BL-846-role-answer-cannot-reach-a-rotating-role-live-pane`)
- BL-722 (task `BL-722-pilot-safe-defects`)

Merged once (single commit satisfies both). A QA merge-up note
(BL-773/819/822/839, approved `06303f63`) arrived first in the same
session and was merged separately per the Merge-Up Protocol (conflict in
`docs/index.md` — both branches had appended distinct how-to links;
resolved by keeping both). That merge-up is not part of this review; it is
recorded only for lineage.

BL-846 is new coder work (`e2ef8824a3`). BL-722 is a one-line fix
(`5042cc22`) for a documenter bounce (`backlog/evidence/BL-722-bounce-20260808.md`)
that added the missing `required_wiring` literal marker comment in
`telegramCursorBridgeLive.ts` — no behavior change. BL-722's substantive
`pilotSafeDefects.ts` work was already reviewed in the prior architect pass
(`backlog/evidence/BL-722-BL-852-BL-847-BL-853-architect-pass-20260808.md`);
this pass reviews only the marker-comment fix plus a fresh look at BL-846.

## Dependency-rule gate (BL-259 REQUIRED HARD GATE)

Node 20.20.2 (host default) cannot run `dependency-cruiser`
(`^22||^24||>=26` required). Switched to Node 22.23.2 via `nvm`:

    PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" node extension/out/tools/dependency-gate.js \
      src/tools/telegram-front-desk-bot.ts src/tools/telegramCursorBridgeLive.ts

Result: FAILED on three `acyclic` edges — `telegram-front-desk-bot.ts` <->
`telegramCursorOperatorExec.ts`/`telegramCursorOperatorLiveness.ts`. This
is the same pre-existing BL-759 cycle already root-caused in the prior
architect pass this session
(`backlog/evidence/BL-722-BL-852-BL-847-BL-853-architect-pass-20260808.md`,
verified against an isolated pre-parcel worktree). Confirmed again here:
the triggering dynamic imports (`telegram-front-desk-bot.ts` lines
2169/2174, `await import('./telegramCursorOperatorExec')` /
`await import('./telegramCursorOperatorLiveness')`) predate BL-846 by many
commits (`git log -L` traces them to `e54d2129`), and BL-846's diff
(`e2ef8824a3`) touches only the new `resolveMonoRouterAwareRoleEntry`
function and one import line near the top of the file — nowhere near the
cycle-triggering code. Not a bounce; BL-759 already tracks the fix.

## Co-change coupling (BL-255, informational)

`co-change-report.js` on both touched files: `telegram-front-desk-bot.ts`
shows a long list of co-changed files, all consistent with its
already-documented hub status (1500+ mutation sites, prior pass). No new
or surprising coupling given the tiny diff (one import, one ~15-line pure
function). `telegramCursorBridgeLive.ts`'s only change is a one-line
comment. Informational only, nothing actioned.

## Architecture review

- **BL-846**: `resolveMonoRouterAwareRoleEntry` is extension-host code
  reading `.swarmforge/mono-router-active-role` via the already-exported
  `readMonoRouterActiveRole` (`extension/src/concierge/residentPaneSpy.ts`)
  — required_wiring's instruction to reuse the existing reader rather than
  add a second one is followed exactly (verified by reading the import and
  call site directly). No webview code touched, no browser storage, no
  secrets, no direct process spawn bypassing tmux — the change is pure
  resolution logic feeding the existing `sendInstructionVerified`/tmux
  path, which is unchanged. `resolveRolePaneTarget` is the single call
  site, matching the ticket's "one behavior, one resolution site" framing
  (also fixes BL-425 steering for rotating roles, as the ticket states).
  "First non-coordinator roles.tsv/sessions.tsv session" as the resident
  definition is verified consistent with the Babashka side
  (`mono-router-resident-session` / `parse-mono-router-resident-session` in
  `swarmforge/scripts/handoff_lib.bb:483-502`) — same semantics, same file
  order (`readSwarmRoles` preserves file line order, confirmed by reading
  `tmuxClient.ts:318-335`).
- **out_of_scope compliance**: diffed each coder commit individually
  (`git diff --stat e2ef8824a3^..e2ef8824a3` and `5042cc22^..5042cc22`) —
  BL-846 touches only `telegram-front-desk-bot.ts`, two new property test
  files, one CLI test file, the promoted feature file, and the step
  registry; BL-722's fix touches only `telegramCursorBridgeLive.ts` (one
  comment line). Neither touches `ready_for_next.sh`, the in-process guard,
  or any role prompt, matching BL-846's own `out_of_scope` list.
- **BL-722**: marker-comment-only change, no behavior, no boundary
  crossing. All four `required_wiring` entries were already confirmed
  wired in the prior architect pass; this fix only satisfies the pre-QA
  wiring gate's literal-string check.

## Invariants review (BL-633/BL-654)

BL-846 declares two invariants (§20-23 of the ticket YAML), neither
scenario-expressible per the ticket's own note ("Two properties the
scenarios cannot express"):

1. "An answer is never injected into a pane running a different role than
   the one it is addressed to" —
   `bl846ResidentPaneResolutionFollowsIdentity.property.test.js`. Drives
   the real compiled `resolveRolePaneTarget` against a randomly generated
   roster, requested role, and marker state (matches / other-in-roster /
   other-not-in-roster / missing / blank) across both coordinator-first and
   coordinator-last roster orderings. Non-vacuity documented and verified
   by reading the test's own inline note: changing the production
   condition to always-redirect reproduced the exact failure the property
   catches.
2. "No answer becomes less deliverable than it is today" —
   `bl846RoleAnswerDeliveryNeverLessDeliverable.property.test.js`. Drives
   the real `pollAndForward` -> `captureRoleAnswer` chain across all four
   (delivered, enqueueSucceeds) combinations, faking only the
   redirect/enqueue/clear adapter boundary. Non-vacuity documented:
   dropping the queued-note fallback in `captureRoleAnswer` reproduced the
   exact failure.

Both non-vacuous, both authored by the coder (first-authorship correctly
rests there per this role's Invariants Review section). No missing or
vacuous property test found. BL-722's fix commit touches no invariant-bearing
code.

## Verification run (independently re-run)

- `npm run compile` (extension/) — clean.
- Acceptance: `node specs/pipeline/cli.js specs/features/BL-846-role-answer-reaches-the-active-resident-pane.feature`
  — 9/9 scenarios passed, all executed (not skipped).
- `npx vitest run --config vitest.properties.config.mjs
  test/bl846ResidentPaneResolutionFollowsIdentity.property.test.js
  test/bl846RoleAnswerDeliveryNeverLessDeliverable.property.test.js` — 2/2
  passed.
- `npx vitest run test/telegramFrontDeskBotCli.test.js
  test/pilotSafeDefects.test.js test/telegramCursorBridgeCore.test.js
  test/telegramCursorBridgeLive.test.js` — 498/498 passed (matches
  cleaner's own count).
- Full `npx vitest run` (extension/): re-run independently (not just
  trusting cleaner's log), twice, since the first run showed 11
  failures/1 unhandled error and the second showed 9 — both are
  load-related noise, not a fixed regression set. Second (clean) run:
  9 failed / 7234 passed / 7243 total, all 9 in two known pre-existing
  categories, neither touching `telegram-front-desk-bot.ts` or
  `telegramCursorBridgeLive.ts`:
  - 6x `dependencyGateCli*.test.js` — same known Node-version gap the
    cleaner and the prior architect pass already flagged: the default
    `node` (20.20.2) cannot run `dependency-cruiser` (`^22||^24||>=26`).
  - 3x `renderBriefingDiagramsCli.test.js` — 20s timeouts. Host load
    average at the time: 71/112/88 (`uptime`), far above the 2x-cores
    threshold this project already treats as disqualifying for
    timing-sensitive tests. Confirmed load-caused, not a regression: an
    isolated re-run of just this file at the same load still failed 2/4
    on timeout. Neither BL-846 nor BL-722 touches briefing-diagram
    rendering.
  - The first run's extra 2 failures (`startBridgeHeadlessCli.test.js`
    timeout, one `[vitest-worker]: Timeout calling "onTaskUpdate"`
    unhandled error) did not reproduce on the clean re-run — further
    confirmation this is host-load noise, not a deterministic defect.

## Verdict

NONE — no defects found across BL-846 and BL-722. Forwarding to hardener.
