# BL-1388 — hardener pass, 2026-09-04

Merged coder commit `e6637bcf68` directly (no cleaner/architect/documenter
stage — `required_stages: [coder, hardender, qa]`: cleaner skipped as
"one fixture block in one test runner is re-tensed; there is no second
copy to de-duplicate", architect skipped as "no design decision - the
assertion's premise is re-tensed to the guard exactly as BL-1371 landed
it", documenter skipped as "no document describes this fixture; BL-1371's
how-to already states the discovery rule").

## What this fixes

`land_step_lib_test_runner.bb`'s "the REAL guard wiring, not the injected
one" block asserted behavior against a hand-maintained `DOMAINS` registry
BL-1371 already retired in favor of pure filesystem discovery
(`Steps.js`-suffix files under `specs/pipeline/steps/`) — the exact
BL-973/BL-1279 class of "a closure enumerated by hand goes stale the
moment the thing it mirrors grows" this session has hit repeatedly. The
runner reported `2 failure(s)` on every run since 2026-09-03 16:57 BST;
now `ALL PASS`.

## A measured, reported, not silently patched-over defect

The coder found the ticket's own "How" section describes TWO ways to make
a handler undiscoverable (missing `Steps.js` suffix, or nested under a
subdirectory) but measured (not reasoned) that
`check-feature-handler-registration.ts`'s `readTree` is non-recursive
(`listDir`, not a walk), so a nested handler is invisible to the guard
entirely and produces no refusal — contradicting the ticket's premise for
that one scenario. Per Article 4.4 this left as a `spec-gap` note, not a
parcel; the specifier amended the ticket to retire the nested-handler
Outline row (never reworded, per BL-1006) and mint **BL-1400** for the
real guard hole this surfaced (a feature can reach `main` with its only
handler parked in a subdirectory). Confirmed this sequencing happened as
described: `backlog/topics/BL-1400.json` exists in this merge, and the
retired row is genuinely gone from the feature file (verified below), not
merely marked.

## Checks re-run, all independently

- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS
  (was a standing red since BL-1371 landed; confirmed genuinely fixed,
  not merely claimed).
- `test_bl1388_land_step_guard_fixture.sh` — 6/6 ALL PASS, including the
  non-vacuity check (rewriting the refusal case's handler to a
  discoverable name makes both refusal assertions fail — the fixture
  genuinely measures the guard, not a fixed string) and the diff-against-
  main check (no assertion outside the fixture block changed).
- `run_acceptance.sh` on the BL-1388 feature — 4/4 pass.
- `check_feature_handler_registration.sh` — rc 0.
- required_wiring anchor grepped directly: `registerSteps` exported from
  `bl1388LandStepGuardFixtureDiscoverySteps.js:64/133`.
- Confirmed the retired Outline row is genuinely gone (not merely
  commented or reworded, per BL-1006): grepped the feature file for
  "nested" — the only surviving mentions are in the new scenario naming
  what is out of scope, not an active row.

## BL-149 cooldown gate

`land_step_lib_test_runner.bb` — DECISION: skip-cooldown (still actively
churning today; this is itself the test file the ticket rewrote, not a
separate production target). No `.bb`/`.sh` PRODUCTION file in this
ticket's own scope — `land_step_lib.bb` and the guard itself are both
explicitly confirmed untouched (the coder's own evidence and e2e check 4
both attest to this; re-verified by re-running the diff-against-main
check above). Nothing here for a hand-authored mutation sweep to target
beyond what the coder's own non-vacuity check (e2e check 2) already
proves.

## BL-113 Gherkin mutation

One `Scenario Outline` present. Ran the real mutation pass: `"outcome":
"pass"`. Confirmed against the embedded manifest per BL-460 discipline:
`{"Total":1,"Killed":1,"Survived":0,"Errors":0}`.

## CRAP / DRY

No `extension/src` file in this ticket's own diff. N/A.

## Process / fixture hygiene

No orphaned `node --test`/mutation processes (three unrelated bash pids
seen by `pgrep` are not test runners). Clean working tree.

## Result

A standing red since BL-1371 landed is genuinely fixed, not merely
silenced; a real defect the coder found along the way (nested-handler
guard hole) was reported via spec-gap note and minted as its own ticket
(BL-1400) rather than folded in or ignored; all checks and the one
required_wiring anchor re-verified independently. Forwarding to QA per
the ticket's own stage skip (documenter also skipped).

By hardener.
