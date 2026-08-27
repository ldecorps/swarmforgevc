# BL-1036 hardener pass — 2026-08-22

**Parcel:** architect forward `72a69ee2d7` (evidence-only commit; the real
diff is the coder's own `4c334f349`, "a front-desk restart releases its
poll slot, and the log closes what it opens"), merged into hardender.
Architect verdict PASS, both declared invariants confirmed non-vacuous by
hand, no defect found, forwarded as-is.

**Verdict: hardened. One real mutation gap closed with five tests.**

## Host load — full Stryker deferred

`uptime` at pass start: load averages 15.16/25.73/33.26 on 4 cores
(>2x cores throughout the pass, later checked again at 12.55/19.50/24.38 -
still over the threshold). Per the load rules, did not attempt even a
concurrency=1 differential Stryker run. No `Scenario Outline:`/`Examples:`
anywhere in the feature (all five scenarios are plain `Scenario:`), so
BL-113 Gherkin mutation is not applicable to this ticket either - the
wrapper would report `inapplicable`, not a pass. In its place: a
hand-authored surgical mutation sweep (below) over the parcel's own changed
decision points, the same posture as BL-1035's own deferred-Stryker pass
this same day. CRAP/DRY also deferred with the mutation pass under the same
load - office-hours bypass, not a skip: full pass owed on the next quiet
host.

## The gap: `runPollCycle`'s own computation of `pollRecovered` /
`pollUnresolved` / `conflictWindow`, and `applyPollCycleResult`'s use of
them, were never actually exercised

`bl1036RestartConflictWindow.test.js` and its property sibling test
`shouldRaisePollRecoveredNotice`, `shouldRaisePollUnresolvedNotice`, and
`describePollConflictWindow` directly, in isolation - real, thorough
coverage of the pure predicates. But nothing in the pre-existing suite
(including `telegramFrontDeskBotCore.test.js`'s own pre-existing
`runPollCycle`/`applyPollCycleResult` tests, which only assert
`consecutiveFailures`/`delayMs`/`degradedWarning`) ever checked that
`runPollCycle` actually WIRES those predicates into the `PollCycleResult`
it returns, or that `applyPollCycleResult` actually reads
`cycle.pollRecovered`/`cycle.pollUnresolved`/`cycle.conflictWindow` to
decide what to write.

Confirmed by hand, each restored before the next:

1. Hardcoded `pollRecovered: false` in `runPollCycle`'s success branch
   (leaving the real predicate call dead code) - all 424 pre-existing tests
   (13 + 2 + 409) stayed green.
2. Hardcoded `pollUnresolved: false` and `pollTimeoutSeconds` to a literal
   `25` in the failure branch - same, all green.
3. Hardcoded the `conflictWindow` call's timeout argument to a literal `25`
   alone (dropping `config.pollTimeoutSeconds ?? 25`) - same, all green
   (this one required strengthening my own first draft test too: it had
   used `pollTimeoutSeconds: 25`, identical to the hardcoded fallback, so it
   could not have told the two apart - fixed to `99`).
4. In `applyPollCycleResult`, replaced both `if (cycle.pollRecovered)` and
   `if (cycle.pollUnresolved)` guards with `if (false)` - same, all green.
5. In `applyPollCycleResult`, dropped the
   `(cycle.conflictWindow ? ` (${cycle.conflictWindow})` : '')` append from
   the degraded-warning line - same, all green.

Added ten tests to `telegramFrontDeskBotCore.test.js`, alongside the
existing `runPollCycle`/`applyPollCycleResult` sections (not the BL-1036
predicate-only file, to match where the pre-existing sibling tests for
these two functions already live): four `runPollCycle` tests pinning
`pollRecovered`/`pollUnresolved`/`conflictWindow` on the returned cycle
object (including the once-per-episode edge-trigger for `pollUnresolved`
on the cycle immediately after the crossing one), and five
`applyPollCycleResult` tests pinning the log lines each field's presence
produces (including the negative cases: no extra line when neither flag is
set, no stray parenthetical when `conflictWindow` is absent). Re-applied
all five mutants above against the strengthened suite: every one now fails
exactly the new test naming it. Restored the source to its pre-mutation
state and diffed clean against the architect's tip before compiling final.

## Pre-existing, already-ticketed guard violations - out of scope, not this
parcel's

The standing whole-tree guards (`extension/test/*Guard*.test.js`, run
because this pass edited a file under `extension/test/`) surfaced two RED
violations, both in files BL-1036 never touches and both already present at
the architect's own tip (confirmed: both existed in `ad2aa27fd`, the
hardener worktree tip before this parcel's merge):

- `specs/pipeline/steps/bl1018SingleRoleRepairNeverKillsServerSteps.js`
  flagged by `tmuxReaperGuard` - read the file: it never runs a live tmux
  server, only asserts over recorded command argv strings including the
  literal `'new-session'` token (its own header comment: "Nothing here runs
  tmux, and that is the design"). A guard false positive.
- `swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb`
  flagged by `tempDirTrapGuard` - a real leaked temp root on any throw.

Both are already minted and sitting in `backlog/paused/`:
`BL-1032-tmux-reaper-guard-fires-on-a-file-that-only-asserts-about-tmux-argv.yaml`
and `BL-1033-bl1025-property-runner-leaks-its-temp-root-on-any-throw.yaml`.
Same disposition as the architect's own BL-759 precedent this pass: already
owned, already graded, not re-litigated or re-bounced under BL-1036.

## Verification re-run live

- `npm run compile` - clean throughout, including after each scratch
  break-and-restore cycle.
- `npx vitest run telegramFrontDeskBotCore.test.js` - 419/419 (409
  pre-existing + 10 new).
- `npx vitest run bl1036RestartConflictWindow.test.js` - 13/13.
- `npx vitest run --config vitest.properties.config.mjs
  bl1036RestartConflictWindow.property.test.js` - 2/2.
- `node specs/pipeline/cli.js
  specs/features/BL-1036-a-restart-does-not-cost-a-telegram-conflict-window.feature`
  - 5/5.
- Standing guards (11 files): 9/11 clean; the 2 red are the pre-existing,
  already-ticketed BL-1032/BL-1033 above.

— By hardener.
