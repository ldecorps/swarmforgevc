# BL-1407 — architect pass, 2026-09-05

Ticket: BL-1407-property-gate-reruns-a-red-in-isolation
Role: architect
Commit reviewed: b9c6e077b0 (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the changed file
  (`specs/pipeline/steps/bl1407PropertyGateRerunsARedInIsolationSteps.js`)
  and full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both
  runs. The new step handler uses only `node:assert/strict`, `node:fs`,
  `node:path`, `node:child_process`, and the repo's `mkProcessTmpDir` test
  helper — no webview import, no VS Code API, no direct process-spawn from
  a view module.
- **Co-change report** (`extension/out/tools/co-change-report.js`) on the
  three changed non-yaml files: only historical co-changes with sibling
  guard-family step/test files (BL-1200/1202/1222/1234 and their own test
  runners) — the expected cluster for this guard, no new suspicious
  coupling.
- **Boundary check**: all changes are in shell (`check_property_suite_drift.sh`),
  a Gherkin step handler (Node, no VS Code API), a Babashka property-test
  runner, and a shell test file — none touch the extension host/webview
  boundary, browser storage, or secrets handling. Integrate-not-fork: the
  change is entirely in this project's own guard/test scripts, not
  SwarmForge's own source.

## Invariants Review (Article 1's Invariants Review section, BL-633/654)

Ticket declares three invariants. Each has a coder-authored property test
(`swarmforge/scripts/test/bl1407_property_gate_rerun_isolation_property_runner.bb`)
covering all three, non-vacuous per the coder's own break-then-fix record
(`backlog/evidence/BL-1407-coder-20260905.md` lines ~96-111: each invariant
shown to fail against a deliberately broken implementation, then restored).

I independently re-ran the property runner in this worktree rather than
trusting the coder's record alone:

```
bl1407 property-gate-rerun-isolation properties: 45 runs, coverage
{:det-red 11, :flaky-touched 11, :flaky-untouched 7, :hang 16}
ALL PROPERTIES HOLD
```

All three declared invariants held; generator reach floors (det-red≥5,
flaky-touched≥2, flaky-untouched≥2, hang≥5) were cleared with margin.

## Acceptance wiring

`specs/features/BL-1407-the-property-gate-reruns-a-red-in-isolation-before-it-refuses.feature`
declares 4 scenarios; `bl1407PropertyGateRerunsARedInIsolationSteps.js`
registers matching step regexes for all of them (Background + all 4
scenarios' Given/When/Then). `registerSteps` export present per the
ticket's `required_wiring` anchor (BL-1371).

## Shell test suite

Ran `swarmforge/scripts/test/test_property_suite_drift_guard.sh` directly:
it fails at pre-existing case 07 (`fail()` exits the whole script) BEFORE
reaching the four new BL-1407 scenarios (19-22). This is NOT a BL-1407
regression: case 07 asserts the pre-commit hook names
`check_property_suite_drift.sh` directly, a check invalidated by BL-1252's
delegation to `run_commit_guards.sh` (landed 2026-08-30, `76dd67b692`) —
already ticketed as **BL-1409** (`backlog/paused/BL-1409-...yaml`,
`status: todo`, human_approval: pending), confirmed by grep before
reporting per this role's out-of-parcel-failure rule.

To verify the BL-1407 scenarios specifically despite the pre-existing
blocker, I ran a scratch copy of the test file (never committed, deleted
after use) with only the two BL-1409-caused `fail()` calls at case 07
replaced with a skip-log, changing no assertions. Result: all 24 scenarios
pass, including the four new ones (19: flake-passes-alone recorded and
allowed; 20: fails-alone still refuses naming the file, no flake record;
21: three non-allowlisted reds each re-run exactly once, allowlisted file
never re-run; 22: re-run past the ceiling counts as a failure).

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to hardender.
