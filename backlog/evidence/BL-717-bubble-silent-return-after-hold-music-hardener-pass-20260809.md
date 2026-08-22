# BL-717-bubble-silent-return-after-hold-music — hardener pass — 20260809

Commit reviewed: `944c9846a8` (architect's forward, `merge_and_process architect
944c9846a8`, batched with BL-854). Merged into this branch as `59daba81`
("Merge architect handoff for BL-854 and BL-717") before any check below was
run (ancestry confirmed via `git merge-base --is-ancestor 944c9846a8 HEAD`).
This ticket already carries `bounce_count: 2` (cleaner, then architect) — both
prior fixes (`6bed2963ab` D1, `94507b75a1` D2) are ancestors of the reviewed
commit; re-verified below rather than trusted from history alone (per "A
Prior QA Bounce Is Not In Your Worktree" discipline, applied here to prior
bounces generally).

## Host load during this pass

Load average ranged 6.99-23.28 (1-min) on 4 cores (up to ~5.8x cores)
throughout this pass — well over the 2x-cores threshold. Per the
office-hours/load-avoidance rule, the full-suite commands (`npm run coverage`,
`npm run crap`, Stryker) were avoided in favor of scoped multi-file `vitest`
runs, which stayed fast (5-9s) and did not hang or crash.

## BL-149 cooldown gate

`bb swarmforge/scripts/mutation_cooldown_gate.bb <root>
extension/src/bridge/letsTalkRoutes.ts` (`SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`
workaround, BL-797) — `DECISION: skip-cooldown` (file_age_days 0.17 of a
3-day window). Stryker mutation is unconditionally skipped this pass for this
file regardless of load, per the gate's own contract — not run.

## Suites run (all green)

- `npm run compile` (extension/) — clean.
- `npx vitest run test/letsTalkBridge.test.js test/letsTalkCore.test.js
  test/letsTalkRoutes.test.js` — 87/87 pass.
- `npm run test:properties -- test/bl717ReplySilenceInvariants.property.test.js`
  — 3/3 pass, the **whole file** re-run (not just the property architect's
  D2 bounce named), per the standing lesson that a fix to one property in
  this file previously broke a different one silently.
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-717-bubble-silent-return-after-hold-music.feature` —
  8/8 scenarios pass (including the Scenario Outline's 4 examples).

## Coverage (scoped — see load note above)

Coverage from the three vitest files above (not the full suite, to avoid a
full-suite run under load):

| file | statements | branches | functions |
|---|---|---|---|
| `letsTalkRoutes.ts` | 198/204 | 66/68 | 12/12 |
| `letsTalkCore.ts` | 357/359 | 151/152 | 46/46 |

The 2 remaining uncovered branches in `letsTalkRoutes.ts` (lines 171, 180:
the `onTurnSuccess` mirror-delivery branch and the `audioBase64 ?? ''`
fallback in `processLetsTalkTurn`) predate this ticket by ~11 days
(`e54d2129a`, 2026-07-29) and are untouched by any of this ticket's three
commits (`95185e43`, `6bed2963ab`, `94507b75a1` — confirmed via `git show
<commit> -- letsTalkRoutes.ts | grep processLetsTalkTurn`, no hits). Out of
scope for this parcel. Every function and branch BL-717 actually touched
(`clientTtsTurnSuccess`, `promptAgentAndSynthesize`, `resolveSpeakableReply`)
is at 100% branch coverage.

## CRAP gate

`node scripts/crapReport.js src/bridge/letsTalkRoutes.ts
src/bridge/letsTalkCore.ts` (against the coverage above) flags 2 functions
over the CRAP<=6 threshold:

- `processLetsTalkTurn` — complexity=12, coverage=85%, CRAP=12.49
- `isLetsTalkTurnRequestShape` — complexity=8, coverage=100%, CRAP=8.00

Both predate this ticket and are untouched by its three commits (confirmed
the same way as the coverage gaps above — `isLetsTalkTurnRequestShape` has
zero diff lines in any BL-717 commit). Out of scope: fixing them would be an
unrelated pre-existing-debt sweep, not this ticket's job. The two functions
BL-717 actually changed are at or under threshold:

- `clientTtsTurnSuccess` — complexity=1, coverage=100%, CRAP=1.00
- `promptAgentAndSynthesize` — complexity=6, coverage=100%, CRAP=6.00

## DRY

`npm run dry` (`jscpd`, whole `src/`) — 36 clones found project-wide (0.57%
duplicated lines), none in `letsTalkRoutes.ts` or `letsTalkCore.ts`. No new
duplication introduced by this parcel.

## Device-side (Android/Kotlin) — attempted, environment-blocked

This ticket's own commits (`95185e43`) extracted a pure `ReplyPlaybackDecision`
out of `ReplyAudioPlayer.kt` with real JVM-testable coverage
(`ReplyPlaybackDecisionTest.kt`, `ReplyPlaybackDecisionPropertyTest.kt`), per
the Testability Boundary — Bubble article. Attempted
`./gradlew :app:testDebugUnitTest --tests
com.swarmforge.floatcompanion.ReplyPlaybackDecisionTest --tests
com.swarmforge.floatcompanion.ReplyPlaybackDecisionPropertyTest`: build
failed — this host's Android Gradle plugin requires JDK 17, and only JDK
11.0.12 / 8u333 / 8u131 are installed; no portable JDK17 + Android SDK is set
up under this worktree's `.swarmforge/` (checked: absent). **BLOCKED BY**
missing JDK 17 toolchain in this environment — recorded rather than assumed
clean, per Article 4.4. This is an environment gap, not a defect in the
ticket's code, and does not gate this forward: the ticket's own acceptance
contract (`description:`) already scopes device-side verification to the
documented manual e2e procedure, not to this pipeline's automated suites.

## No orphaned processes

`pgrep -fl 'node --test|stryker'` (scoped to this worktree) — none.
`pgrep -afl tmux` — only the live swarm's own
`.swarmforge/tmux/*.sock` session, not a leaked fixture.

## Findings

NONE outstanding. The JDK17 gap above is recorded as BLOCKED, not a defect,
and does not block this forward per the ticket's own acceptance contract.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-717-bubble-silent-return-after-hold-music`.

By hardender.
