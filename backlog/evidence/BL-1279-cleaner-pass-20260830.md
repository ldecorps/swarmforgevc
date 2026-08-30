# BL-1279 — cleaner pass

Cleaner, 2026-08-30. Merged coder's `501dedf09f` (commit `<see next>`), clean
merge, no conflicts.

## Verification

- `npm run compile` clean.
- All four fixtures run standalone, ALL CHECKS PASSED, exit 0:
  `test_front_desk_supervisor_bl622_refusal.sh`,
  `test_front_desk_supervisor_tick.sh`,
  `test_front_desk_supervisor_liveness.sh`,
  `test_front_desk_supervisor_fleet_creds.sh` (all four were dying at
  `front_desk_supervisor.bb:98:1` or failing 3/8 checks before this commit).
- `node specs/pipeline/cli.js specs/features/BL-1279-...feature` → 10/10.
- `extension/test/bl1279FrontDeskFixtureClosure.property.test.js` (properties
  lane) → 2/2.
- `BL-973-*.feature` re-run per constraints ("everything BL-973 shipped
  stays"): 12/13. The one red (`every bb test file is run by a standing gate
  or explicitly excluded`) is the ticket's own flagged, pre-existing,
  unrelated defect — a manifest row BL-1276 added, already present at my
  pre-BL-1279 tip (`3edaffd80a`), confirmed by `git show` against that
  commit. Not this ticket's to fix; the coder surfaced it to the specifier
  rather than sweeping it in, correctly.
- `run_bb_suite.sh`'s inventory check separately flags
  `task_scope_gate_acceptance_exemption_property_runner.bb` as misnamed for
  the manifest's naming convention — also pre-existing at `3edaffd80a`
  (`git log` shows it introduced in `e5ca86243`, before BL-1279), unrelated
  to front-desk fixtures.
- Full `vitest run --config vitest.config.mjs`: 219 failures / 27 files,
  identical to the pre-merge baseline (same set as BL-1274/BL-1277's cleaner
  passes) — no regression from this merge.

## Code review

- `swarmforge/scripts/test/lib/bb_fixture_load_guard.sh`: new,
  single-purpose (`assert_bb_closure_present`), documents why a load-probe
  isn't available (the entry point ends in a bare `(-main)`, so loading it
  runs it) rather than leaving that as an unexplained design choice.
- Each of the four shell fixtures: the hand-listed `cp` line replaced by
  `copy_bb_closure "$SRC" "$d" front_desk_supervisor.bb` plus
  `assert_bb_closure_present` before the first check — directly satisfies
  invariant 2 (no check may pass against a subprocess that never started).
  Neither missing lib is named anywhere in the diff, as the ticket requires
  ("derive, don't patch").
- `bbFixtureClosureGate.js`: four new `FIXTURES` entries, same shape as the
  existing `kind: 'shell-copy'` precedent (`test_lean_ledger_bb_wiring.sh`);
  comment updated (five -> nine fixtures) rather than left stale.
- Out-of-scope items honored: `front_desk_supervisor.bb` itself untouched,
  BL-973's five fixtures and Examples table untouched, no fixture-membership
  auto-derivation attempted (correctly deferred per the ticket's own
  out_of_scope section).
- No `extension/src/**` changed; CRAP/mutation/DRY gates don't apply here
  (same basis as BL-1274/BL-1277).

Forwarding to architect.
