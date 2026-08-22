# BL-879 hardener review — clean pass, NONE

**Ticket:** BL-879 — swarm review-stamp-off of the human-landed
parent-orphaned front-desk fast-reap hotfix (commit `36ea0109e9` on `main`).
**Reviewed commit:** `740267314` (architect, forwarded cleaner/coder's work
unchanged after review).
**Role:** hardender.

## Scope note

The production `.bb` fix (`process_table_lib.bb`, `orphan_janitor_lib.bb`,
`orphan_janitor_sweep_lib.bb`) is already on `main` via the human-landed
hotfix (`36ea0109e9`) — zero diff in this parcel. This ticket's own diff vs
`main` is only the acceptance/property-test infrastructure: the promoted
`.feature`, its step handlers, the acceptance-runner JSON bridge, and the
property-test runner. Hardening here is verification, not code-mutation
hardening of the fix itself (matches the ticket's own "review, not rewrite"
posture).

## Independent re-verification (all run directly, not trusting prior evidence)

1. `process_table_lib_test_runner.bb` — ALL CHECKS PASSED.
2. `orphan_janitor_lib_test_runner.bb` — ALL CHECKS PASSED.
3. `orphan_sweep_enumeration_unavailable_test_runner.bb` — ALL CHECKS PASSED.
4. `bl879_parent_orphaned_front_desk_property_runner.bb` — ALL PROPERTIES
   HOLD (32 exhaustive P0, 300 generated runs each P1/P2, 4 real-JVM P3
   scenarios).
5. `specs/pipeline/scripts/run_acceptance.sh` on the promoted `.feature` —
   8/8 scenarios pass.
6. **BL-113 soft Gherkin acceptance mutation** — both `Scenario Outline`
   blocks in the feature (`...-01` and `...-03`; the other three scenarios
   are plain `Scenario:` with no Examples to mutate, per BL-638) mutated via
   `run_gherkin_mutation.sh ... soft`: 8/8 mutants killed, 0 survived, 0
   errors. Durable verdict recorded in the feature file's own embedded
   manifest (`acceptance-mutation-manifest-begin/end`), not the stdout
   summary alone (BL-460/BL-502 read-the-manifest discipline).
7. Manual spot probes against the real acceptance-runner JSON bridge,
   independent of the checked-in scenarios:
   - Host-repo-rooted front-desk cmdline, parent gone, fresh: `reaped:false,
     isCandidate:false` — confirms invariant 1 (decapitation guard) holds
     even for a cmdline that would otherwise match the front-desk pattern.
   - Disposable-root babysitter cmdline, parent freshly gone: `isCandidate:
     true, reaped:false` — confirms invariant 3 (only front-desk class
     fast-paths; babysitter stays on the ordinary age gate) independent of
     the checked-in scenario wording.

## CRAP / DRY / Stryker — degraded gate, as the ticket itself records

No file under `extension/src` or `extension/media` is touched by this
parcel (confirmed via the architect's dependency-gate run and independently
by `git diff --stat main HEAD`: only `.bb`, `.feature`, and
`specs/pipeline/steps/*.js` files changed). Stryker (`--mutate out/**/*.js`)
and CRAP (`src/*.ts` coverage lookup) are scoped to the extension TS tree
and jscpd's DRY config is scoped to `extension/src` — none apply here. The
Babashka layer has no mutation/CRAP/DRY tooling wired at all
(engineering.prompt Startup Tools). This is the documented degraded
fallback, not a skipped gate: BL-113 Gherkin mutation is the load-bearing
mutation-equivalent gate for this parcel's own new coverage (the step
handlers + acceptance/property runners), and it ran clean (see 6 above).

## No orphaned processes

`pgrep -fl 'node --test|stryker'` and `pgrep -afl tmux` checked before and
after all runs (scoped to this worktree): nothing leaked. The acceptance
runner is a pure JSON-in/JSON-out `bb` subprocess per call, never a tmux
fixture, so there is no fixture-tmux class to reap here.

## Disposition

No survivors, no defects, no coverage gaps found. Forwarding to documenter.

By hardender.
