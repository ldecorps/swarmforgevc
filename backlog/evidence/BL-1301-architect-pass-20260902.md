# BL-1301 — architect pass, 2026-09-02

Reviewed commit `393634823a` (coder), merged into architect as `e62ca5c3c6`.

## Checks run
- Dependency gate (full-repo scan): `node extension/out/tools/dependency-gate.js`
  → PASSED, no forbidden edges. Parcel touches no extension/TS modules.
- Co-change report on `chase_sweep_lib.bb`, `handoffd.bb`,
  `bl1301ParkedTicketSteps.js`: no pair at or above the default frequency-3
  threshold; expected 1-count co-changes with sibling BL-1301 files only.
- Property runner `bl1301_parked_ticket_invariants_property_runner.bb`: ALL
  PASS (P1 opt-in/fail-closed, P2 blast radius, P3 never invisible) — covers
  all three declared `invariants:` on the ticket.
- `dropped_parcel_test_runner.bb`: ALL PASS.
- `dispatch_gap_test_runner.bb`: 2 pre-existing failures
  (`top-expedited-paused-candidate*`), unrelated to this parcel — already
  tracked as BL-1271 (stale bug fixtures in that suite), confirmed via
  `grep -rl "top-expedited-paused-candidate" backlog/`. Not reported as new.
- `bl1301ParkedTicketSteps.js` registered in `specs/pipeline/steps/index.js:921`;
  feature file present at `specs/features/BL-1301-a-parked-ticket-is-not-a-dropped-parcel.feature`.

## Architecture
- Suppression check lives inside `decide-dropped-parcel?` / the new
  `dropped-parcel-evaluation`, not in the shared `read-active-items` reader —
  matches invariant 2's blast-radius requirement.
- `handoffd.bb` logs suppressions on the same per-ticket cooldown clock as
  nudges — matches the ticket's stated rationale (avoid per-tick log spam).
- Two-layer boundary, webview storage, secrets, integrate-not-fork: N/A,
  parcel touches only `.bb` daemon/sweep code and JS acceptance steps.

## Verdict
Clean sweep — no defect found. Forwarding to hardener.
