# BL-1195 hardener pass — round 2 (2026-08-28)

## Reviewed commit

Merged architect's `c4fb41408d` (round 2, on cleaner `fa62fc86c` / coder
`f0365f155`) clean into hardender. This is the re-fix after my own bounce
of round 1 (`dfd885f9f4`, `backlog/evidence/BL-1195-hardener-bounce-20260828.md`)
and the architect's independent bounce of the coder's first re-fix
(`backlog/evidence/BL-1195-architect-bounce-20260828.md`).

## What changed

Round 1's union-of-in-process-mailboxes fix is replaced by a full
carve-out: `enforce-worktree-drift-guard!` in `ready_for_next.bb` now
skips the drift check entirely whenever the invoking role's own
`worktree-name` is `"master"`. Verified this actually closes my own
literal reproduction, not just the shipped tests: re-ran the exact
fixture from my round-1 bounce evidence directly against this commit.

## Re-verification of my own original repro

```
$ SWARMFORGE_ROLE=coordinator bb .../ready_for_next.bb
INVALID_RECEIVE_MODE: guard-boundary-only for role coordinator
```

No `WORKTREE_DRIFT_DETECTED` — control now reaches past the guard. This is
the first round my repro actually passes; confirmed independently of the
architect's own re-run of the same fixture.

## Hand-mutation probes on the new carve-out (`ready_for_next.bb`)

The `.bb` change has no wired mutation tool (Babashka — gated by its own
unit-test suite per engineering.prompt). Hand-mutated the live file
directly (no detached job outstanding), ran the regression suite, restored
immediately after each probe, confirmed `git diff` clean before proceeding
to the next:

1. Inverted `when-not` to `when` (carve-out fires for non-master instead of
   master) — scenario 04 caught it (`WORKTREE_DRIFT_DETECTED` where none
   was expected). Killed.
2. Changed the literal `"master"` to `"Master"` (case mutation) — scenario
   04 caught it the same way. Killed.

Both mutants killed by the existing regression suite
(`test_worktree_drift_guard_master_resident_exempt.sh`) with no changes
needed — scenario 06 (non-master control) also confirmed still passing
throughout, proving the carve-out is scoped to `"master"` specifically and
not a blanket disable.

## Full verification (re-run)

- `bash .../test_worktree_drift_guard_master_resident_exempt.sh` — ALL
  PASS (04/05/06).
- `bash .../test_worktree_drift_guard.sh` (original single-worktree
  scenarios, unchanged) — ALL PASS (01/02/03), no regression.
- `bb .../worktree_drift_lib_test_runner.bb` — ALL PASS.
- `bb .../worktree_drift_lib_property_runner.bb` — ALL PROPERTIES HOLD
  (100 runs).
- `node specs/pipeline/cli.js specs/features/BL-1195-...feature` — 3/3
  pass (plain Scenarios only, no `Scenario Outline:` — BL-113 Gherkin
  mutation is inapplicable per BL-638, not run).
- Confirmed the round-1 `master-resident-sibling-has-in-process-parcel?`
  function and its renamed-away test file
  (`test_worktree_drift_guard_master_resident_sibling.sh`) leave no
  dangling references anywhere (grep, both clean).
- `suite-manifest.tsv` correctly carries the renamed test, no stale entry
  for the old name.
- No `extension/` or `specs/pipeline/steps/` files touched by this round
  — the whole-tree guard sweep does not apply here.
- No orphaned `node --test`/stryker/tmux processes; no leftover `/tmp`
  fixtures from this pass (mutation probes ran directly against the
  worktree file with immediate restore, no detached run outstanding at any
  point).

## Disposition

Hardened. The carve-out closes my own reproduction for real this time,
verified independently rather than trusting the commit message or the
architect's re-run alone. Both hand-mutation probes on the new logic were
killed by the existing suite with no gaps found. Forwarding to documenter.
