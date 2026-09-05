# BL-1425 — architect pass, 2026-09-05

Ticket: BL-1425-a-queue-jump-places-the-ticket-past-the-depth-cap
Role: architect
Commit reviewed: fbc06d9e80 (cleaner NONE pass)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: nothing suspicious.
- **jscpd**, independently re-run (new step handler against its modeled
  sibling `bl1083PromotionGateSteps.js`): `0 clones`.
- **mutation-site-count**, independently re-run: `backlogWriter.ts` 222,
  `telegramFrontDeskBotCore.ts` 2036, `bridgeServer.ts` 1889 — all "over"
  the 100 threshold, but confirmed pre-existing massive hub files
  (250/3961/2501 lines respectively BEFORE this ticket's diff, via `git
  show <parent-commit>:<path> | wc -l`) that this parcel only lightly
  touches. `expediteSafety.ts` (the one genuinely new/small module): 28,
  within threshold. Agree splitting an established multi-thousand-line hub
  is out of scope for this small feature.
- **Register check**: neither `backlog/standing-reds.tsv` nor
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` names this
  file family — correctly, this is a fresh feature.

## First run showed 2 failures — traced to my own stale build, not a defect

My first acceptance run of this feature showed 2/7 failing (crossing not
reported; Approvals notice empty). Before treating this as a real defect
I checked whether it was environmental: recompiling (`npm run compile`,
since I had reverted/restored several TypeScript files for earlier
tickets' non-vacuity checks this session, leaving `extension/out/` stale
relative to this exact merge) immediately fixed it — **7/7 pass**, stable
across two further runs. Not a defect in the parcel; recorded here so the
next reviewer does not chase the same false lead.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"Only a caller-declared queue-jump crosses the depth cap... no script
   the coordinator or the daemon runs ever declares the mode"** — read
   `evaluate` in `promotion_gates_lib.bb` directly: every gate except
   `depth-refusal` runs in the identical `or` chain order; `depth-refusal`
   is wrapped in `(when-not queue-jump? ...)`, so when true it evaluates
   to `nil` and the chain falls through correctly to `{:ok true ...}`.
   Confirmed `grep -c -- --queue-jump` on
   `promote_and_route_next.sh`/`route_backlog_to_coder.sh`/`handoffd.bb`/
   `chase_sweep_lib.bb` is 0 for each, myself.
2. **"The bypass lives inside the one promotion-gates chokepoint... no
   second copy of the depth-cap rule exists in TypeScript"** — confirmed
   `backlogWriter.ts`'s crossed-parsing is gate-name-agnostic (matches any
   non-`orthogonality` ADVISORY line, never restating
   `active_backlog_max_depth` as a TypeScript literal); BL-1083's own
   still-passing property test is what actually proves no gate name
   appears as live code outside the chokepoint, not merely a comment.
3. **"A queue-jump past the cap is never silent and never widens the
   cap"** — read `evaluate`: `:crossed` is added only when BOTH
   `queue-jump?` and `depth-exceeded?` hold — a queue-jump under the cap
   correctly reports no crossing, never overstating what happened. The
   ticket fills a real active slot; no cap-widening logic anywhere in the
   diff.

## Independently confirmed non-vacuity myself (not just trusted)

Backed up `promotion_gates_lib.bb`, mutated the crossing check to
`(when (and queue-jump? false) ...)`, reran the acceptance feature:
**1 failure** (scenario 01 row 1, no crossing reported when the cap was
in fact crossed) — matching the coder's own claimed non-vacuity result
exactly. Restored the file, confirmed byte-identical via `diff` and
`git status --short` (empty), reran — 7/7 again.

## Independently re-verified the substance

- `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb` — **ALL
  PASS**.
- `bb swarmforge/scripts/test/promotion_gates_cli_test_runner.bb` — **ALL
  PASS**.
- `bb swarmforge/scripts/test/promotion_gates_lib_property_runner.bb` —
  **500 runs each, ALL PROPERTIES HOLD**.
- `node specs/pipeline/cli.js
  specs/features/BL-1425-a-queue-jump-places-the-ticket-past-the-depth-cap.feature`
  — **7/7 pass**, twice.
- `node specs/pipeline/cli.js
  specs/features/BL-1083-every-promotion-path-goes-through-the-gate.feature`
  (depth-cap row retired) — **4/4 pass** (was 5).
- `node specs/pipeline/cli.js` on `BL-721` and `BL-490` (regressions) —
  **4/4, 8/8 pass**.
- `npx vitest run test/{telegramFrontDeskBotCore,backlogWriter,pausedPagerBridge,pausedPagerUiHtml}.test.js`
  — **532/532 pass**.
- `npx vitest run --config vitest.properties.config.mjs
  test/{bl1083PromotionGateInvariants,bl721QjumpQueueJumpInvariants,bl1091ExpeditePromotionCommit,bl1380ExpediteNeverAnswersUnshownQuestion}.property.test.js`
  — **16/16 pass**.

All matching both the coder's and cleaner's claimed counts exactly.

## Retirement review (BL-1006: retire, never reword)

Read all three retirement diffs directly:
- `specs/features/BL-1083-...feature`: exactly one Examples row
  (`active_backlog_max_depth`) removed, nothing else touched.
- `specs/pipeline/steps/bl1083PromotionGateSteps.js`: the matching `else`
  branch that built the depth-cap fixture replaced with an explicit
  `throw` for an unrecognised `<gate>` — keeps the handler honest rather
  than silently falling through to something unintended.
- `extension/test/bl1083PromotionGateInvariants.property.test.js`: the
  matching `REFUSING_GATES` entry removed, replaced with an explanatory
  comment, no other line reworded.

Minimal, correctly scoped, matches the ticket's own retirement
instructions exactly.

## required_wiring

All four anchors confirmed present by direct grep/read:
`backlogWriter.ts`'s `runGateCli` passes `--queue-jump`;
`telegramFrontDeskBotCore.ts` requests `{queueJump: true}` at the shared
`recordExpediteDecisionAndClose` call site (BL-721's shared routine, so
both the Q jump tap and `/qjump` inherit it); `bridgeServer.ts`'s paused-
pager Expedite route passes `{queueJump: true}`; the new step handler is
discovered by directory scan (BL-1371), confirmed by the acceptance run
passing 7/7.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found. Forwarding to hardener.
