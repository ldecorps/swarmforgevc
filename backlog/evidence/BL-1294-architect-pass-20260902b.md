# BL-1294 — architect pass — 20260902b (rework re-review)

**Merged:** cleaner `f9d951bc1e` ("NONE, coder's D1 rework verified") into
architect, fast-forward from `e136eeed02`.

## Verdict: PASS — forward to hardender. Review inventory: NONE (in-parcel).

## Context

Prior architect pass (`BL-1294-architect-pass-20260902.md`) PASSed the
parcel; a second architect look (`BL-1294-architect-bounce-20260902.md`,
commit `1f548517f9`) then found D1: the new acceptance steps file's
Background-created `liveDir`/`fixtureRoot` scratch dirs were never cleaned,
leaking 2 dirs/scenario (8/run). This pass re-reviews the coder's fix of D1
(verified untouched by cleaner — cleaner's commit is evidence-only, `NONE`).

## D1 fix verified

`cleanupLiveAndFixtureDirs(ctx)` added to
`bl1294FixtureScriptClosurePreservesDependencyPathsSteps.js`, called from a
`finally` in both scenario 01/02 terminal steps and scenario 03's terminal
step. Re-ran the feature directly:

    ls /tmp | grep -c bl1294   → 73 before, 73 after run_acceptance (4/4 green)

Confirms no leak. Also re-verified scenario 03's own `probe` dir (created
and removed inline, unrelated to D1) is untouched — still cleaned at its
original call site.

## Re-ran full gate set (nothing else changed since the PASS pass)

- `node extension/out/tools/dependency-gate.js` on the parcel's 5 files:
  same single pre-existing `acyclic` edge
  (`bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js` ↔
  `specs/pipeline/steps/index.js`, lazy require) already confirmed
  out-of-parcel and already reported via `note` in the prior PASS pass — not
  re-reported (grepped `backlog/` again, no new ticket, same standing
  status).
- `node extension/out/tools/co-change-report.js`: same expected
  pinnedRepoFixture-family coupling, nothing new.
- Invariants (BL-654): unchanged from the PASS pass — both P1/P2 still
  non-vacuous, re-ran green (2/2, `npm run test:properties`).
- `extension/test/pinnedRepoFixture.test.js`: 16/16 green.
- `specs/pipeline/cli.js` on the BL-1294 feature: 4/4 green.

## Handoff

`git_handoff` to hardender, priority `00`, task
`BL-1294-fixture-script-closure-preserves-dependency-paths`, commit
`f9d951bc1e`.

By architect.
