# BL-1289 — architect pass, 2026-09-05

Ticket: BL-1289-a-temp-root-is-always-cleaned-up
Role: architect
Commit reviewed: bec7915529 (cleaner — a NONE pass, no code changes; see below)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1289TempRootAlwaysCleanedSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is entirely Babashka/shell test-runner code (one-line shutdown
  hooks in bb runners, `register_tmp_dir` adoption in shell runners) plus a
  Node step handler — no webview, no VS Code API, no secrets, no browser
  storage.
- **Co-change report** on a couple of the touched files
  (`fixture_isolation.sh`, `local_coder_battery.sh`): only pre-existing
  sibling coupling from unrelated tickets — nothing new or suspicious.
  (A full per-file co-change report across all 27 touched runners would be
  excessive for a uniform, mechanical fix; the cleaner already ran the
  full regression suite and spot-checked the trickiest call site.)

## The design question the ticket deliberately left open (why cleaner stayed in the chain)

The ticket's `approval_context` explicitly kept the cleaner stage in
because "whether the bb runners should get an equivalent shared helper...
is a real design call." The cleaner's own pass (this commit, code-diff-free)
reviewed that question and found the coder's approach correct as-is: bb
runners got minimal per-file JVM shutdown hooks (`Runtime/addShutdownHook`
deleting tracked temp dirs), and shell runners adopted the PRE-EXISTING
shared `lib/tmp_cleanup.sh`/`fixture_isolation.sh`'s `register_tmp_dir` —
exactly the helper the guard's own message names, not a new one invented
for this ticket. I independently confirm this was the right call: 27
near-identical, mechanical one-to-few-line additions do not warrant a new
abstraction, and reusing the existing shared shell helper (rather than a
parallel bb one, given bb already has trivial native shutdown-hook
support) avoids introducing machinery this ticket's own `mutation_cost:
low` / `slice_size_envelope: low` did not anticipate.

## Invariant, verified against both halves

"Every temp root a runner creates is removed on every exit path it
controls, AND a root left behind by a killed run is swept before the next
run asserts — cleanup alone is never sufficient (nothing traps SIGKILL)."

- **Cleanup half**: read `fixture_isolation.sh`'s diff — `register_tmp_dir`
  is called immediately after `mktemp -d`, on top of (never replacing) the
  file's own pre-existing lock/reap/bound machinery. Spot-checked several
  bb runner diffs (`bl533_exit_gates`, `bl683_backlog_folder_count`,
  `bl1421_one_standing_surfacing_property_runner`) — each adds either a
  `Runtime/addShutdownHook` or wraps the existing body in `try/finally`;
  none alters the test's own assertions or generator logic (confirmed by
  re-running `bl1421`'s property suite myself: 500 runs each, ALL
  PROPERTIES HOLD, unchanged from my earlier BL-1421 review).
- **Sweep-before-assert half (the SIGKILL case)**: this is
  `fixture_isolation_reap`'s pre-existing, UNTOUCHED next-run owner-
  liveness sweep (BL-1390) — the ticket's own description says as much
  ("the same discipline BL-971 records for the JS fixtures"). Verified
  scenario 03's real drive of this function myself: a stale root stamped
  with a genuinely-dead pid is reaped before the next run makes any
  assertion — confirmed independently (see below).

## Independently re-verified the substance

- `npx vitest run test/tempDirTrapGuard.test.js` → 4/4 pass (was the
  standing red; now green — confirmed directly, not inferred).
- `bb post_qa_branch_sweep_lib_test_runner.bb`,
  `swarm_shift_lib_test_runner.bb`,
  `master_checkout_integrity_lib_test_runner.bb`,
  `self_heal_telemetry_lib_test_runner.bb`,
  `retirement_registry_lib_test_runner.bb`,
  `rotation_telemetry_lib_test_runner.bb` → all `ALL PASS`/`ALL TESTS
  PASSED`, no regression from the added shutdown hooks.
- `bb bl1421_one_standing_surfacing_property_runner.bb` (touched by this
  parcel, previously reviewed by me for BL-1421) → 500 runs each, ALL
  PROPERTIES HOLD — confirms the try/finally wrap changed nothing about
  the property's own behavior.

## Acceptance wiring — driven end-to-end myself

Feature declares 3 scenarios / 4 scenario runs. Independently drove
`bl1289TempRootAlwaysCleanedSteps.js::registerSteps` against all 4 with my
own harness — all passed, including scenario 03, which spawns a real dead
process, stamps a real stale fixture root with its pid, and drives the
REAL `fixture_isolation_reap` shell function to confirm the leftover is
actually gone before any assertion — not a synthetic stand-in for the
SIGKILL-survival guarantee. `registerSteps` export present per the
ticket's `required_wiring` anchor (BL-1371).

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to QA per this
ticket's `required_stages: [coder, cleaner, architect, qa]` (hardener and
documenter correctly skipped per the ticket's own `stage_skip_reasons`).
