# Cleaner pass — BL-855 (2026-08-08)

## Context
Coder handoff (d207aa1c0b) merged: BL-855, a no-op-landing-merge detector
wired as a sibling check ahead of `qa-gate-decision` in
`push_sweep_lib.bb`'s `sweep!`, plus the real git adapter in `handoffd.bb`
and coder-authored property/unit tests.

## Review scope
- `swarmforge/scripts/push_sweep_lib.bb` — `noop-landing-merge?` /
  `noop-merge-decision` / their wiring into `sweep!`'s `:should-push`
  branch, consulted before `qa-gate-decision` per the ticket's
  `required_wiring` literal. Pure, well-commented, follows the file's own
  established "small per-caller duplication over cross-file coupling"
  convention already documented in its header — not a DRY violation to
  flag.
- `swarmforge/scripts/handoffd.bb` — `push-sweep-noop-merge-gate-facts!`
  and its helpers (`git-diff-name-only`, `noop-merge-commit-facts`) mirror
  the existing `push-sweep-qa-gate-facts!` adapter shape; both revs passed
  to `git diff` are explicit refs, never the working tree (satisfies the
  ticket's invariant 3). No structural issues.
- Test files (`push_sweep_lib_test_runner.bb`,
  `push_sweep_lib_property_runner.bb`, `push_sweep_cli.bb`,
  `test_handoffd_push_sweep_wiring.sh`) — thorough coverage of all 3
  declared invariants, each with an explicit non-vacuity check against a
  deliberately broken implementation. No cleanup needed.

## CRAP / DRY / mutation (Babashka scope)
Per the constitution's Startup Tools table, `.bb` files have no wired
mutation/CRAP/DRY tool — `swarmforge/scripts/test/` unit and property
suites are the actual gate for swarm scripts. Both ran clean (below).
Mutation-site-count.js does not apply (TS/`out/**/*.js` only).

## Verification run
- `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb` — ALL TESTS
  PASSED.
- `bb swarmforge/scripts/test/push_sweep_lib_property_runner.bb` — 500
  runs, ALL PROPERTIES HOLD, including two new BL-855 non-vacuity checks.
- `bash swarmforge/scripts/test/test_handoffd_push_sweep_wiring.sh` — FAILS
  locally with `env: setsid: No such file or directory`. Confirmed
  pre-existing and environmental, not a BL-855 regression: every other
  `setsid`-based wiring test in this suite
  (`test_handoffd_cooldown_sweep_wiring.sh` spot-checked) fails identically
  on this host — macOS lacks `setsid` (a Linux util-linux command); this
  script was not touched by this cleaner pass and the pattern predates
  BL-855 (see `test_handoffd_role_context_clear_skip_rotation_router.sh`'s
  own `command -v setsid` guard for the known workaround, not adopted here
  since it is out of this ticket's scope).
- `npm run compile` — clean, no TS surface touched by this ticket.

## Verdict
NONE — no defects found. Forwarding to architect.
