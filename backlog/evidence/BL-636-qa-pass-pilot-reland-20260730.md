# BL-636 QA pass (re-land, cursor-as-expeditor /pilot)

Date: 2026-07-30

Prior land dropped off current main; re-cherry-picked onto tip after BL-627 re-land.
Kept HEAD's `enqueue-babysitter-wake!` deliver! close (conflict vs old BL-611 paren-only restore).

## Checks

- `mono_router_lib_test_runner.bb` ok
- `test_handoffd_priority_rotate_wiring.sh` ALL PASS
- Acceptance 6/6 via `bl636Only.js`

## Result

Pass. Ticket moved paused→done.
