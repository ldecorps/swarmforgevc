# BL-746 — hardener pass — 2026-08-14

## Scope received

Batch handoff from architect (`f912278236`, merge_and_process), routed as
its own `git_handoff` (task name
`BL-746-bl637-lifecycle-shell-test-reimplements-instead-of-driving-real-script`),
separately from BL-891 and from BL-892's earlier chain, per Article 2.6.
`f912278236` was already an ancestor of this worktree's HEAD (rode in via
the prior BL-892 hardening pass' merge); no new merge was needed.

Files in scope, per coder's commit `7f30ede4d`:
- `specs/pipeline/steps/bl746StopSwarmRealRefuseGatesSteps.js`
- `specs/pipeline/steps/lib/bl746StopSwarmFixture.js`
- `specs/pipeline/steps/index.js` (registry wiring)
- `swarmforge/scripts/test/bl746_stop_swarm_refuse_gate_property_runner.js`
- `swarmforge/scripts/test/test_lifecycle_script_scope.sh` (the rewritten
  stop-path scenarios, the ticket's headline deliverable)

None of these are `extension/src/*.ts` / compiled `out/**/*.js` or under
`extension/src` for DRY — Stryker and jscpd's `dry` script are both scoped
there (confirmed: `npm run dry` = `jscpd --config .jscpd.json src`, `npm run
mutation` = Stryker against compiled extension output). CRAP likewise scopes
to `src/*.ts`. None apply to this ticket's changed files. BL-113 Gherkin
mutation DOES apply — the feature has two `Scenario Outline:` blocks — and
was run.

## Pre-flight

- No orphaned test/mutation processes from a prior run
  (`pgrep -fl 'node --test|stryker'` clean before starting).
- `uptime` at pass start: load avg 6.31/6.10/6.63 on 4 cores (~1.6x),
  elevated but under the 2x-cores threshold.
- `extension/src/*.ts` was newer than `extension/out/*.js` (BL-892's own
  changes hadn't been recompiled since); ran `npm run compile` before the
  acceptance pre-check per the BL-497 stale-`out/` trap, even though this
  ticket's own files don't touch `extension/`, to avoid a false-fail on any
  shared acceptance plumbing.

## Test verification

- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-746-stop-swarm-real-refuse-gates.feature`:
  **5/5 scenarios pass** (both Outline example rows for scenario 1, the
  plain scenario 2, both Outline example rows for scenario 3).
- `bash swarmforge/scripts/test/test_lifecycle_script_scope.sh`:
  **BL-637 results: PASS=15 FAIL=0**, including the new scenario 06
  (`kill_rc`-driven refuse) and the corrected 04c (asserts the real script's
  literal `"full stack SUCCESS — no known survivors"` line — the headline
  wording-mismatch defect this ticket exists to close).
- `node swarmforge/scripts/test/bl746_stop_swarm_refuse_gate_property_runner.js`:
  **9 runs (exhaustive over 3 survivor shapes x 3 kill_rc values), ALL
  PROPERTIES HOLD**.

## BL-113 Gherkin acceptance-mutation

`specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-746-stop-swarm-real-refuse-gates.feature` (soft, no prior
stamp — ran fresh): **Total 6, Killed 3, Survived 3, Errors 0**.

Killed (real defects this ticket's assertions catch):
- m1: `named` "babysitterd" → "babysitTerd" — killed (scenario 1 row 1
  fails at the survivor-name assertion).
- m3: `named` "Operator" → "OperatoR" — killed (scenario 1 row 2 fails at
  the survivor-name assertion).
- m4: `survivor argv` "--remote-control Operator" → "--remoTe-control
  Operator" — killed (the mutated argv no longer matches
  `stack_survivor_scan.sh`'s `*"--remote-control Operator"*` pattern, so the
  process is no longer flagged as a survivor at all and the exit-status
  assertion fails).

Survived, judged **equivalent** per BL-234 (code-level reason given, no
artificial assertion forced):

- m2: `survivor argv` path casing "…/.swarmforge/operator/babysitterd.sh…"
  → "…/.swarmforge/operaTor/babysitterd.sh…". `stack_survivor_scan.sh:37`
  matches only on the substring `*babysitterd.sh*` in the full argv line —
  the directory-name spelling immediately preceding it is not part of the
  match condition. Any casing of "operator" in that path is treated
  identically by the code under test; no assertion could ever
  differentiate the mutant from the original. Equivalence confirmed by
  reading `stack_survivor_scan.sh:33-43` directly, not inferred.
- m5: `kill_rc` example value `7` → `4`. m6: `kill_rc` example value `3` →
  `8`. `stop-swarm.sh:91-94` refuses on `[[ "$kill_rc" -ne 0 ]]` and
  re-exits with that exact value (`exit "$kill_rc"`), with no special-casing
  of any particular non-zero integer. Because the scenario's `<kill_rc>`
  placeholder is substituted consistently into the stub's exit code AND
  every assertion in the same generated scenario, any two distinct non-zero
  integers are interchangeable by design — the row's specific numeric
  choice is arbitrary test data demonstrating "an arbitrary non-zero code
  propagates," not a value the code branches on. Confirmed by reading the
  refuse gate directly: no `case`/specific-value check exists, only the
  non-zero test.

This is the exact BL-234 shape (unrecognized-value-class equivalence, not a
convenient excuse) — 3/3 survivors have a demonstrable code-level reason,
and the 3 killed mutants confirm the assertions are load-bearing against the
actual regressions this ticket was written to catch (wording mismatch,
casing, and the argv-pattern match itself).

Manifest written into the feature file
(`# acceptance-mutation-manifest-begin/end`, `scenarios: []`) — expected per
BL-502: both mutated scenarios (1 and 3) had at least one survivor each, so
neither is written to the clean-scenarios list; that is not evidence the
tool didn't run (the run's own stdout `total=6 completed=6 killed=3
survived=3 errors=0` is the authoritative signal it ran, per BL-460/BL-502).

## Post-run cleanup check

`pgrep -fl 'node --test|stryker'` and `pgrep -afl tmux` both clean after all
runs — only the live swarm's own `swarmforge-coder` and `operator` tmux
sessions present. The Gherkin-mutation run's step handlers spawn
`stop-swarm.sh` as a plain subprocess (no tmux fixture server), so the
BL-807 leaked-fixture-tmux risk does not apply to this ticket's step
handlers.

## Verdict

Hardened: functional acceptance, shell suite, and property test all green;
Gherkin mutation run to completion with every survivor accounted for as a
demonstrated equivalent mutant, not a real gap. Forwarding to documenter as
its own `git_handoff`, per Article 2.6 (this ticket's own task name, not
folded into BL-892's forward).

By hardener.
