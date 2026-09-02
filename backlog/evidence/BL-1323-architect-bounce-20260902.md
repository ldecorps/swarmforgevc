# BL-1323 — architect bounce, 2026-09-02

Reviewed commit `9e5d1750d1` (cleaner), forwarding coder's stamp-off review
of hotfix `9c94735f03` unchanged.

## Review inventory (complete pass, Article 4.4)

- BL-848 review discipline: confirmed the hotfix ledger row for
  `9c94735f03` is untouched (`state: stamp-open`, `human_decision: null`,
  `backlog/hotfix-ledger.yaml` lines 233-239) — no reimplementation, no
  ledger write. PASS.
- `swarmforge/scripts/babysitter_check.bb::gather-main-sync-deadlock`
  (lines 789-825): confirmed by reading the source — marker's
  `normalize-overlapping-paths` preferred first, `(sh! "git" "-C" ...)`
  corrected shape used only on fallback. Matches the coder's qa_e2e answer
  (1) exactly. PASS.
- `deadlock-alert-text`/`operator-deadlock-hint` reuse and the generic
  "wait for BL-891 reconcile" text removal: confirmed by `grep` — zero
  hits for the old text, `deadlock-alert-text` at
  `master_main_reconcile_lib.bb:729` literally wraps
  `operator-deadlock-hint`. Matches qa_e2e answers (3)/(4). PASS.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` —
  ALL TESTS PASS.
- `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb` — ok.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1323-main-sync-deadlock-hints-name-overlaps-and-teach-swarm-heal.feature`
  — 7/7 scenarios pass.
- `node extension/out/tools/dependency-gate.js` on the property test —
  PASSED, no forbidden edges.
- required_wiring: all three entries confirmed present (the marker
  preference, the trip-time persistence, and this parcel's own step
  handler registered at `specs/pipeline/steps/index.js:20`).
- Snapshot-not-live limitation (item 5): confirmed correctly reported, not
  silently fixed, per the ticket's firm line — the follow-up mint is left
  to the specifier, as the coder's evidence states.

## D1 — the coder-authored property test's own coverage-floor is flaky (same class as BL-1343)

**Failing check**: `npx vitest run --config vitest.properties.config.mjs
test/bl1323StampOffInvariants.property.test.js`, repeated 15 times.

**Commit tested**: the coder's commit forwarded by cleaner `9e5d1750d1`.

**Observed**: 2 failures in 15 runs, both:
```
AssertionError: never exercised the failed-read sentinel
```
Not a production-code failure — `reach.sentinel`'s own self-check
(line 151), not an assertion about `master_main_reconcile_lib.bb`.

**Root cause, computed from the generator (lines 111-123)**: `pathsArb` is
an `fc.oneof` with weights `{empty: 1, sentinel: 1, ordinary: 2, overCap:
2}` over total weight 6, so `P(sentinel) = P(empty) = 1/6 ≈ 0.167` per
draw. At `numRuns: 20`: `P(sentinel never drawn) = (5/6)^20 ≈ 2.6%`, and
the same for `empty` independently — combined `P(at least one of the two
low-weight corners missing) ≈ 1 - (1-0.026)^2 ≈ 5.1%`. Empirical: 2/15 ≈
13%, in the same ballpark given the small sample, and both observed
failures hit exactly the lower-probability corner the math predicts is
most fragile.

**Failure class**: `test-reliability` (property-test authorship rests with
the coder per BL-654; this is the identical defect shape D1 in
`BL-1343-architect-bounce-20260902.md` named earlier today — a reach-floor
assertion whose own generator does not guarantee reaching it, contradicting
the file's own stated "asserted, not hoped for" design intent).

**Why this matters here specifically**: this ticket exists to certify a
hotfix on the operator's *only* actionable signal during a main-sync
deadlock (per the ticket's own severity rationale). A flaky property test
attached to that certification is exactly the kind of noise that erodes
trust in this machinery's own gates — a spurious red on a re-run invites
exactly the "just re-run it" response this whole review exists to prevent
becoming routine.

**Remediation pointer**: `extension/test/bl1323StampOffInvariants.property.test.js`,
`pathsArb` (lines 111-123) and the `reach.*` floor assertions (lines
149-152). Force each corner to be reached by construction — the fix
already adopted twice today in this same session for BL-1343
(`f89d6eadff`): draw the SHAPE explicitly (empty / sentinel / ordinary /
over-cap) and run each as its own dedicated property pass, rather than
relying on `fc.oneof` weights to probabilistically cover a low-weight
corner. Owning role: **coder** — property-test authorship for a new file
rests with the coder (BL-654).

## Inventory close
No other defect found. This is the only item (D1). Routing to `coder`.
