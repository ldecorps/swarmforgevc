# BL-1071 — coder re-pass after unhold (2026-08-24)

Prior stamp-off (see earlier sections of this file / evidence trail) already
closed review goals 1–7. This re-pass was needed because **BL-1102** changed
`daemon_cycle_guard_lib/sh!` to return `{:spawn-failed? true}` instead of
throwing — so a missing `tmux` no longer reached babysitter_check's
`observe!` catch, and was misclassified as `:control-plane-missing` (CRIT +
`./swarm ensure`) instead of `:unavailable`.

## Fix landed this parcel

`control_plane_lib.bb` `probe-server!` forwards `:spawn-failed?`; `observe!`
maps that to `:unavailable` with `:error`, never to a missing-plane recovery.

Acceptance (10/10), `control_plane_lib_test_runner.bb`, and the degraded gate
scripts remain the stamp-off surface (no mutation/CRAP/DRY for these layers).
