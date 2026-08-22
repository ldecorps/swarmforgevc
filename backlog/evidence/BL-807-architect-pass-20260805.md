# BL-807 — architect review pass (2026-08-05)

Reviewed commit: e8bec1e14f (cleaner's forward, merged into architect worktree
via 5d596deb..e8bec1e14f).

## Checklist

- **Dependency-gate (extension/out/tools/dependency-gate.js)**: N/A — this
  parcel touches no `extension/` files at all (verified via
  `git diff --name-only 5d596deb e8bec1e14f -- extension/` → empty). Nothing
  to run the gate against.
- **Co-change tool (extension/out/tools/co-change-report.js)**: run against
  both changed `.bb` files. All flagged "SUSPECTED COUPLING" is the same
  babysitter subsystem the ticket itself wires together (babysitter_check.bb
  <-> babysitterd_sweep_lib.bb <-> their own test runners <-> the step
  registry index) — expected, inherent coupling per R5, not a violation.
- **Two-layer boundary / extension-host I/O ownership / webview storage /
  secrets**: N/A — no extension/webview code touched.
- **Integrate-not-fork**: N/A concern here — `swarmforge/` is the maintained
  fork (Local Engineering rule #2); editing its own scripts directly is the
  correct place for this fix, not a boundary violation.
- **Declared invariant** ("A stuck-in-process warning is never raised for a
  parcel whose owning role the same sweep classifies busy — for any mailbox
  shape, role, or parcel age."): encoded as P5 in
  `babysitterd_sweep_lib_property_runner.bb`. Verified non-vacuous myself:
  reverted the `:when (not owner-busy?)` guard in `check-stuck-in-process`,
  reran the property runner — it failed (multiple FAILs), restored the file,
  reran clean — `ok`. `git status` confirmed no diff left behind.
- **Wiring is real, not inert**: confirmed `stuck-parcels` is called with
  `busy-by-role` at the actual gather call site (babysitter_check.bb:418),
  and that `in-process-claims` (check 10) is called with the exact same
  `busy-by-role` map built once at line 396 — check 5 and check 10 consume
  one shared signal, satisfying R1 architecturally, not only in the isolated
  property test.
- **Glob semantics** (`"{,**/}inbox/in_process/*.handoff"`, the R4 no-double-
  count claim): verified empirically with a standalone bb repl against a
  fixture with both a flat and a role-nested file present — each file
  matched exactly once, both shapes matched by the one glob.
- **Scope discipline vs out_of_scope**: `stuck-min` unchanged (still 30, R2);
  no new durable state / motion tracking added (R3); `classify-pane-busy?`
  untouched; only check 5's own decision function and the shared gatherer
  changed, check 10 untouched apart from reusing the now-generalized
  `owning-role-for-path`.
- **Acceptance**: ran
  `node specs/pipeline/cli.js specs/features/BL-807-babysitter-stuck-in-process-warn-ignores-owner-liveness.feature`
  directly — all 11 scenarios pass against the real CLI and a real tmux
  server (busy/idle panes, both mailbox shapes, no-double-count).
- **Unit + property suites**: `babysitterd_sweep_lib_test_runner.bb` and
  `babysitterd_sweep_lib_property_runner.bb` both `ok`.
- **Property-testing improvement pass (undeclared properties)**: the only
  other touched pure function is `owning-role-for-path` (two-regex path
  parser). Assessed and left uncovered by a new property test: it is a
  2-branch, structurally-disjoint regex dispatch already exercised end-to-end
  by the acceptance suite across every production role shape (specifier and
  coordinator as role-nested master, coder as flat worktree); the coder's own
  P5 carve-out already documents this as I/O-adjacent plumbing better proven
  at the acceptance layer, matching the established P4 precedent. A property
  test here would just re-assert regex escaping, not a real invariant — no
  new test added, said so rather than manufacture a vacuous one.

## Verdict

NONE — no architecture violation, no invariant violation, no correctness
defect spotted. Forwarding to hardener.

By architect.
