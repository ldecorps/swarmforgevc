# BL-631 architect pass — D1 bounce-fix re-review, 2026-08-19

Reviewed commit: 3eac819b2 (via cleaner's merge a7e6443e2f).

## Scope
QA bounced D1 only: `bl631BabysitterDetectsPipelineCodeOnMainSteps.js`'s
`addFakeCoordinatorPane` hand-rolled its own `trackedSockets`/`afterEach`
teardown instead of the shared `fixtureReaper.js` `track()`/`reap()`
(BL-458/BL-817 precedent) — an afterEach-only teardown installs no exit/
SIGINT/SIGTERM handlers, leaking the fake coordinator's detached tmux
server on a killed run. Single-file fix, replaces the hand-rolled array
with `track(root)`/`reap(root)`.

## Verification
- `node extension/out/tools/dependency-gate.js` on the changed file: PASSED,
  no forbidden edges.
- `node extension/out/tools/co-change-report.js` on the changed file: no
  suspected coupling (max 1 co-change per pairing).
- `npx vitest run test/tmuxReaperGuard.test.js`: 7/7 pass, including "the
  real specs/pipeline/steps tree has zero tmux-reaper violations" — the
  exact check D1 failed on. Confirms the fix.
- `fixtureReaper.js` exports `track`/`reap` as used; no `vscode` import in
  the changed file.

## Invariants / required_wiring
Out of scope for this fix — D1 is test-fixture teardown hygiene, not the
sweep's detection logic. The ticket's 3 invariants and required_wiring
(QA-exclusive path definition, UNAVAILABLE-not-clean-sweep) are untouched
by this diff and were already verified PASS in QA's own D1 bounce
inventory (`backlog/evidence/BL-631-qa-bounce-20260819.md`) before this
fix — nothing here reopens them.

## Verdict
COMPLIANT. Forwarding to hardener.
