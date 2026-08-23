# BL-1071 — architect pass — 20260823 (third pass, post-D1-refix)

## Context

Second time back from cleaner after my own D1 bounce
(`BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix-bounce-20260823b.md`):
scenario 06 (specifier's mid-flight goal-4 amendment) had no step handler.
Merged cleaner's forwarded tip (`65ad1431c7`, itself `Merge coder BL-1071 into
cleaner`) into the architect worktree at `a36323e9c`. The merge also carried
main's already-landed BL-1101 -> BL-1107 ticket rename transitively; the
pre-commit hook's dropped-file guard required naming BL-1101 in the merge
commit message to confirm it, which I did — no retirement work performed
here, just picked up through the merge chain.

## D1 remediation: verified fixed

Coder's re-fix (`5f8ac93ab`, 3 files, +88/-1) adds the three missing step
definitions for scenario 06 and, while doing so, found and fixed a real
production defect: `assemble-findings`' own `:keys` destructuring never
named `control-plane-error`, so the reason an observation failed was
captured by the gatherer and rendered by `check-control-plane` — both
correct in isolation — but silently dropped in the one place between them.
Fixed by adding `control-plane-error` to `assemble-findings`' destructuring
list (`babysitterd_sweep_lib.bb:525`, `:538`); traced the whole path
end-to-end myself (`babysitter_check.bb:1072-1098` catch → `:control-plane-error`
in the snapshot → `assemble-findings` → `check-control-plane`) and confirm
the fix is minimal and correctly targeted at the one gap.

Ran, not assumed:

- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1071-....feature`
  — **10/10 pass**, including scenario 06.
- `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb` — ok,
  including the two new assemble-findings assertions (reason carried;
  no recovery queued regardless of launch-scripts presence).
- `bash swarmforge/scripts/test/test_babysitter_check.sh` — ALL PASS
  (15/15).
- `npm run test:properties` scoped to both BL-1071 property files — **4/4
  pass** (invariants 1, 2, 3 all still hold over the full probe-failure
  lattice / bounded-recovery cases).

## Dependency gate (BL-259 hard gate)

Files straddle the `extension/` boundary, so ran a full-repo scan
(`node extension/out/tools/dependency-gate.js`, no args) per
[[bl259-dependency-gate-and-npx-namespace-trap]]. Result: **3 acyclic
violations, all in `telegramCursorOperator*` / `telegram-front-desk-bot.ts`
— confirmed pre-existing on `main` itself** (reran the identical scan from
the separate `main` worktree checkout, identical three edges), and already
ticketed (`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`).
Not introduced by this parcel, not touched by this parcel's file set. No
action; not this ticket's scope per its own "do not widen" instruction.

## Co-change report

Ran against the three re-fix files. Only SUSPECTED COUPLING flags are among
`bl1071BabysitterSweepSurvivalSteps.js` / `babysitterd_sweep_lib.bb` / its
test runner / `babysitter_check.bb` / `specs/pipeline/steps/index.js` —
expected co-evolution of one feature and its own test/registry
infrastructure, not undesirable coupling. No action.

## Invariants review

All three declared invariants have non-vacuous property tests (break-then-
restore documented in the property file's own header, three separate
breaks tried and all correctly went RED, then restored — confirmed by
reading, and independently reran green above). No invariant violation.

## Property testing

Existing `bl1071SweepSurvivesAnyProbeFailure.property.test.js` (invariant 3)
does not itself assert the failure reason propagates into the finding
message or that no recovery is queued — those two specific behaviors are
covered instead by the new acceptance scenario (end-to-end, real sweep) and
a new pure Babashka unit test directly on `assemble-findings` (fast,
isolated, break-then-fix verified in the coder's own commit). Three
independent layers of coverage for one small plumbing fix is sufficient;
did not add a further property-test layer on top — would be gold-plating,
not closing a real gap.

## Everything else (unchanged from the prior pass, re-confirmed where the
re-fix could plausibly have disturbed it)

- Extension-host/webview boundary, browser-storage, secrets-in-host,
  integrate-not-fork: not implicated — parcel touches only Babashka scripts
  and Node test/step-handler files.
- `required_wiring` anchor (`bl1071BabysitterSweepSurvivalSteps` registered
  in `specs/pipeline/steps/index.js`): still present, untouched by the
  re-fix.
- The QA-bounced `ps-scope` re-fix (`374bce315`) reviewed in the prior pass:
  untouched by this commit, still green.

## Verdict: PASS — forwarding to hardender.

By architect.
