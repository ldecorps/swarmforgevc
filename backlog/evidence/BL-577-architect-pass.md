# BL-577 — architect PASS (rework commit 8e646b84e5 / work commit 14f7683a9a)

Verdict: **architecturally COMPLIANT and the bounced correctness defect is
fixed.** Forwarded to the hardener.

## The bounce is resolved

`backlog/evidence/BL-577-bounce.md` bounced `d92138649f` because the alarm was
recorded as sent on an ATTEMPT: a failed outbox append was swallowed, the
`:tier` was still written to durable state, and `decide-tier` then suppressed
that parcel's warn AND escalate alarms forever (the BL-333 shape).

The rework fixes it at both ends:

- `handoffd.bb/flow-watchdog-emit-alarm!` now returns `true` only after the
  append succeeds and `false` from the `catch`.
- `flow_watchdog_lib.bb/run-sweep!` treats a falsy return **or a throw**
  (`(try (boolean (...)) (catch Exception _ false))`) as unconfirmed and leaves
  `acc-state` untouched for that parcel, so the next sweep re-evaluates the
  same `highest-tier-alarmed` and re-alarms.

This is stronger than the log-backstop I asked for in remediation item 1: an
alarm whose channel is broken is now DEFERRED, not lost — it fires with full
text as soon as the outbox write succeeds, instead of being written to the log
once and never delivered. The no-repeat-within-tier guarantee is intact
(state is still written exactly once per *successful* alarm).

Coverage added is non-vacuous and pins all three arms:

- `acceptance-13` — falsy emit → no `:tier` recorded, re-attempted next sweep
  (attempt count 1 → 2).
- `acceptance-13b` — throwing emit → sweep does not crash, nothing recorded.
- `acceptance-13c` — flaky emit → two attempts, tier recorded once the write
  confirms, and **no third attempt** afterwards (proves the retry does not
  become a repeat-alarm loop).
- Scenario 13 added to `specs/features/BL-577-...feature` with wired handlers.

## Gates run

- **Dependency gate (BL-259 hard gate)**: PASSED on the parcel's changed JS
  (`../specs/pipeline/steps/bl577FlowWatchdogParcelAgeInvariantSteps.js`,
  `../specs/pipeline/steps/index.js`). No forbidden edges.
- **Tests**: `bb swarmforge/scripts/test/flow_watchdog_test_runner.bb` →
  `ALL PASS`; `test_handoffd_flow_watchdog_wiring.sh` → both assertions pass
  against the real daemon.
- **Co-change (BL-255, informational)**: the parcel's own files rank 3–4 as
  expected. `handoffd.bb` ↔ `specs/pipeline/steps/index.js` (39) and
  `handoffd.bb` ↔ `chase_sweep_lib.bb` (12) are the pre-existing hub couplings
  already noted in the bounce evidence; unchanged by this parcel.
- **Layer/boundary review**: unchanged from the bounce evidence's "What passed"
  section — pure decision core vs impure `run-sweep!`, all environment access
  through injected adapters, handoffd holds only thin wiring. The new
  confirmation signal travels through the existing `:emit-alarm!` adapter
  contract (documented at the adapter-key comment), so no new coupling from the
  library to the environment.
- **Daemon safety**: the sweep call site (`handoffd.bb:2251`) is wrapped in
  `try/catch` → `flow-watchdog-sweep-error`, so a `write-state!` failure logs
  and the cycle continues; because state was not written, that parcel re-alarms
  next sweep. Consistent with the new contract.

## Property testing — not applicable this round, deliberately

The parcel touched `flow_watchdog_lib.bb` and `handoffd.bb` (Babashka) plus a
Gherkin step handler. The project's property framework is fast-check over JS
modules (`extension/test/*.property.test.js`, `npm run test:properties`); it
cannot reach a `.bb` module. `parcel-age-ms` / `humanize-age-ms` monotonicity
and `decide-tier`'s "never returns `:none` for an un-alarmed over-threshold
parcel" are genuine property candidates, but they are Babashka-side and there
is no `.bb` property harness — the same gap engineering.prompt already records
for `.bb` mutation/CRAP/DRY (BL-472). No property test was written rather than
manufacture a vacuous one.

## Follow-up commit `2ca3e5521c` — remaining bounce items closed

A second cleaner forward arrived mid-review (`2ca3e5521c`, work commit
`a9bde4d25`, a descendant of `8e646b84e5`) and closes both remaining items
from the bounce evidence:

- **Remediation item 1**: `(log! "flow-watchdog-alarm" text)` moved OUT of the
  `try` and BEFORE the outbox write, matching `endless-loop-halt`'s ordering,
  so the log backstop the ticket promises now exists on the write-fails path
  too. On a healthy channel the log volume is unchanged (at most one line per
  successful warn/escalate alarm); on a broken channel the repeated line is
  the desired evidence, and the write is still retried until confirmed.
- **Secondary item**: `read-state`'s docstring corrected from
  `{:tier :alarmedAt :snoozed?}` to `:snoozed`, matching the reader at
  `snoozed?` and the on-disk key the tests pin — so a later snooze-**writer**
  slice cannot follow the docstring into a key the reader ignores.
- Plus an exec bit on `flow_watchdog_test_runner.bb` (cosmetic; sibling
  runners are mixed).

Re-verified on the merged follow-up: `flow_watchdog_test_runner.bb` →
`ALL PASS`; `test_handoffd_flow_watchdog_wiring.sh` → both assertions pass.
No JS changed in the delta, so the dependency-gate result above stands.
`2ca3e5521c` is the commit forwarded to the hardener; it supersedes the
earlier architect forward `df1d94cdfc` (same ticket, strict ancestor).

## Residual items — non-blocking, no rework needed

1. `flow-watchdog-emit-alarm!` remains the third verbatim copy of the
   outbox-append block in `handoffd.bb` (lines ~885, ~922, ~1461); folding it
   into `daemon_alarm_lib.bb` stays a worthwhile follow-up, not this ticket's
   work.
2. No `.bb` property-test harness exists (see above) — tracked alongside the
   `.bb` mutation/CRAP/DRY gap (BL-472).

## Scope note (BL-506)

The branch carries `extension/docs/briefings/2026-07-24.json` from
`6d2d727d1 "Cost & health sidecar for 2026-07-24 — By coder (BL-213
deterministic emitter)"`. That is a generated data artifact committed by
BL-213's own `costHealthSidecar.ts` (`commitScopedFile`), not stray hand
edits, so it is ticketed and non-functional. Not treated as a BL-506
violation. Every other file in the parcel belongs to BL-577.
