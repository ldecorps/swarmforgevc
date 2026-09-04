# BL-1380 — hardener pass, 2026-09-04

Merged architect commit `47db7cc629` (clean pass, no bounce —
`backlog/evidence/BL-1380-architect-20260904.md`). Merge was
conflict-free; three unrelated CLI fixtures (BL-1379/BL-1381's) lost
their executable bit in the merge (functionally harmless, invoked via
`bash <script>`), restored in a follow-up commit (`e1ec37bd13`).

## Checks re-run, all independently

- `npm run compile` — clean.
- `npx vitest run pausedPagerBridge.test.js` — 25/25 PASS (drives the
  real HTTP route).
- `npx vitest run --config vitest.properties.config.mjs
  bl1380ExpediteNeverAnswersUnshownQuestion` — 2/2 PASS (P1+P2 combined,
  P3), both through the real `startBridge` route.
- `run_acceptance.sh` on the BL-1380 feature — 6/6 PASS.
- `run_acceptance.sh` on the BL-1367 feature (shares `bridgeServer.ts`)
  — 4/4 PASS, no regression.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.

## CRAP (extension/src touched this time — not N/A)

`npm run coverage` failed on ~16 pre-existing unrelated test files (a
standing, unowned red — `unreachableStepHandlerCheck.test.js` et al.,
`checkOrphanedAuthoredDocs is not a function`), which by default leaves
`coverage-final.json` unwritten. Forced the write per the documented
workaround: `npx vitest run --coverage --coverage.reportOnFailure=true`.
This parcel's two touched/new functions in `bridgeServer.ts` both score
clean: `classifyExpediteRulingRefusal` (new) CRAP 2.00, complexity 2,
100% coverage; `handlePausedPagerExpediteRoute` (the new call site added)
CRAP 2.00, complexity 2, 100% coverage. `bridgeServer.ts` is the
documented shared dispatcher carrying pre-existing CRAP debt from
functions this parcel never touched — those readings are unchanged noise,
not a regression from this ticket. Note per the `reportOnFailure` caveat:
this is a floor for files touched by the ~16 unrelated reds, but neither
touched function here is in that set.

## DRY

`npx jscpd --config .jscpd.json src` — 75 pre-existing clones repo-wide,
none involving `bridgeServer.ts`. No new duplication introduced.

## BL-149 cooldown gate

`extension/src/bridge/bridgeServer.ts` — DECISION: skip-cooldown (still
inside the 3-day window, this ticket's own commit). No Stryker mutation
pass run this pass; the property test's rigor (both properties driven
through the real HTTP route, not the classifier in isolation) plus the
6/6 + 4/4 acceptance coverage substitute.

## BL-113 Gherkin mutation (the one Scenario Outline)

Ran `run_gherkin_mutation.sh` soft. 2/2 mutants killed, 0 survived, 0
errors. Manifest stamped.

## Result

No defect found. No orphaned test/mutation processes belonging to this
pass left behind (confirmed via `pgrep`; the node processes visible
belong to another worktree's own in-flight work, not this one).
Forwarding to documenter.

By hardender.
