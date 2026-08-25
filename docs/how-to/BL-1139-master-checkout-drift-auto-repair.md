# Auto-repair durable master-checkout daemon-script drift (BL-1139)

BL-839 detects when daemon-executed scripts on the master checkout no longer
match `main` (`MASTER CHECKOUT DRIFT`). Mute follow-ons
([BL-1122](BL-1122-master-checkout-drift-mutes-warn-while-commit-in-flight.md) /
[BL-1134](BL-1134-master-checkout-drift-mute-covers-post-add-window.md) /
[BL-1137](BL-1137-master-checkout-drift-mute-covers-cwd-scoped-git.md)) only
silence mid-commit false WARNs. Durable drift still needed a human until
this slice.

## What changed

`repair-master-checkout-drift!` in `master_checkout_drift_lib.bb` runs from
`handoffd.bb`'s `master-checkout-drift-sweep!` after classify:

1. **When** durable drift on the daemon-executed path closure and
   `commit-in-flight?` is false → `git checkout main -- <path>` for those
   candidates only.
2. **Re-check** — on success emit one-shot Operator note
   `MASTER CHECKOUT DRIFT RESTORED: …` (paths named); deferred-bounce
   handoffd via `start_handoff_daemon.sh` / `restart-handoffd-group!` so
   `load-file` state matches disk.
3. **Fail-closed** — restore failure or residual drift keeps the existing
   `MASTER CHECKOUT DRIFT` WARN.
4. **In-flight** — no restore; mute rules unchanged.

`check-master-checkout-drift!` stays write-free. Repair candidates are always
a subset of `resolve-daemon-executed-paths` — non-daemon paths are never
restored.

## Operator signal

- **RESTORED** note → durable daemon drift was cleared automatically; no
  manual `git checkout main -- …` needed for that episode.
- **WARN** still means inspect / decide (restore failed, residual drift, or
  non-repairable case) — see [BL-839](BL-839-master-checkout-drift-alarm.md).

## Out of scope

Moving daemons onto a committed ref; auto-committing drift onto `main`;
repairing non-daemon paths; weakening mid-commit mute.

Acceptance: `specs/features/BL-1139-master-checkout-drift-auto-repair.feature`.
