# BL-1371 — architect re-run, 2026-09-03 (expedite re-run, stage 03)

The first expedite run passed all six stage verdicts and failed on its ticket
half (`run.json`: failed-half=ticket, exit code 1). This is the re-run's
architect stage, re-verified against the branch tip (`294a05226c`) rather than
trusting the original pass (`724ef8f714`).

Production code is byte-identical to the coder's original commit
(`5a54d66774`); the only changes since the first architect pass are the
hardener's one new unit test + mutation-manifest header (already reviewed by
the cleaner re-run), the documenter's doc pass, and the specifier's re-run
note recording the two-copy `required_wiring` land hazard (bookkeeping, not
code). Every check below was re-run from scratch rather than quoted.

## Checks run this pass

| Check | Result |
|---|---|
| `node out/tools/dependency-gate.js` (scoped to `featureHandlerRegistrationCheck.ts`, `featureHandlerRegistrationTypes.ts`) | PASSED, no forbidden edges |
| `node out/tools/dependency-gate.js` (full-repo scan) | PASSED, no forbidden edges |
| `node out/tools/co-change-report.js` over the parcel's changed files | flagged coupling is `stepCollisionGuard.js` ↔ BL-1277-era files (pre-existing, evidence dated 2026-08-30, before this ticket) and test-file self-coupling within the parcel; no new cross-ticket entanglement |
| `npx vitest run` — `bl1371StepDiscovery.test.js`, `featureHandlerRegistrationCheck.test.js`, `checkFeatureHandlerRegistrationCli.test.js` | 46/46 pass |
| `npx vitest run --config vitest.properties.config.mjs` — `bl1371StepDiscoveryInvariants.property.test.js`, `bl1303FeatureHandlerRegistration.property.test.js` | 6/6 pass; reach floors met (P1 120 draws, P2 4 shapes × 3 positions, P3 120 draws) |
| `swarmforge/scripts/test/test_check_feature_handler_registration.sh` | 9/9 PASS |
| `specs/pipeline/scripts/run_acceptance.sh` BL-1371 feature | 5/5 scenarios pass |
| `node extension/out/tools/check-feature-handler-registration.js .` | exit 0 |
| `HANDLER_SUFFIX` mirrored-literal test (BL-897) | present, `bl1371StepDiscovery.test.js:210-213` |
| `required_wiring` anchor | `module.exports = { registerSteps };` present as real code at `bl1371StepDiscoverySteps.js:407` (line 56 is a fixture string, excluded) |

## Invariants (re-verified, not re-derived — the coder's re-run already re-proved them independently)

1. Set equivalence of loaded handler identities and registrations — re-proved twice by the coder re-run as a strict superset (+1, this ticket's own handler), never a count. Non-vacuous: breaking discovery to drop a file turns P1/P2/P3 red.
2. Loud, named failure on an unloadable handler — P2 property + acceptance scenario 4 (`a handler that cannot be loaded fails the run`), both green; non-vacuity re-checked this pass via the coder's two deliberate breaks (`loadHandler` swallowing, `.slice(0,-1)` dropping a file), both reverted cleanly.
3. Adding a handler file touches no other file — P3 property + acceptance scenario 3, green.

No violation of any declared invariant.

## Architecture

Two-layer/extension-host/webview-storage/secrets/integrate-not-fork rules are
not applicable — the parcel touches only the acceptance-pipeline step
registry and its TS commit-gate, no extension host/webview/UI code.
`check_feature_handler_registration.sh` remains narrowed per the ticket's
explicit instruction, not retired as a side effect (confirmed unchanged from
the first pass).

## Correctness

No new defect spotted this pass. The two-copy `required_wiring` land hazard
(this branch's `backlog/paused/...yaml` vs `main`'s
`backlog/active/...yaml`, each with a different anchor) is already recorded
by the specifier's re-run (commit `97c0625226`) as a bookkeeping hazard for
land time, not a code defect — nothing further to add.

## Verdict

Pass. Forwarding to hardener, same as the first pass — no architecture
violation, no correctness defect, invariants hold.
