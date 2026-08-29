# BL-1247 hardening fix landed ~1 minute before the id-collision retirement ruling

## What happened

- `b617a292e6` (hardener, 2026-08-29 02:08:39): while resuming an abandoned
  mid-merge of `main` (MERGE_HEAD present, 3 files conflicted), the hardener:
  - Resolved `handoffd.bb`'s `master-main-reconcile-sweep!` gating conflict
    **in favor of BL-1247-reconcile-sweep-kill-switch's shape** (gate in
    front of `sweep!`, off means `sweep!` is never called) over BL-1248's
    already-shipped shape (`enabled?` passed into `sweep!`, which still runs
    drift/dirty-blocked/escalation while off).
  - Removed the orphaned `master-main-reconcile-enabled?` wrapper this left dead.
  - **Found and fixed a genuine latent bug**: `swarmforge.conf` carried a
    **duplicate `master_main_reconcile_enabled` key** (one block per ticket's
    commit); both `reconcile-enabled?` and `parse-enabled?` read only the
    first matching line, so a later edit to the second, newer-looking block
    would have silently had no effect. Merged into one block.
  - Updated BL-1248's own `test_handoffd_master_main_reconcile_wiring.sh`
    (hardcoded stale "skipped-by-config" text) to expect "skipped-disabled".
  - Re-ran `master_main_reconcile_lib_test_runner.bb` (ALL PASS),
    `master_main_reconcile_lib_property_runner.bb` (ALL PROPERTIES HOLD),
    BL-1247 acceptance (7/7, twice), `test_handoffd_master_main_reconcile_wiring.sh`
    (ALL SCENARIOS PASS, via `detach_job.sh`).

- `f5a609554` (specifier, 2026-08-29 02:09:44, on `main`): adjudicated the
  BL-1247 id collision — the `reconcile-sweep-kill-switch` claimant is
  **superseded, not colliding**: the kill switch was already re-minted as
  BL-1248 and shipped (`swarmforge.conf:352`, closed `0a7ebc81d`). Ruling:
  "retire it, do not renumber."

## The conflict

The retirement ruling was made ~65 seconds after the hardener finished real,
tested work whose central claim is that **BL-1248's shipped shape is wrong**
(the narrower "runs but declines to write" reading BL-1247's own description
explicitly rejects) and should be replaced by BL-1247's shape — plus an
independent, real bug fix (the duplicate config key) unrelated to which
ticket's semantics win.

Documenter cannot adjudicate production semantics (own role prompt, "Does Not
Own"). This parcel was received via a QA-recognized dispatch
(`.swarmforge/handoffs/inbox/in_process/00_20260829T010857Z_000961_from_hardender_to_documenter_for_documenter.handoff`,
payload `merge_and_process hardender b617a292e6`) but was NOT merged into the
documenter worktree pending this ruling, to avoid either silently landing a
semantics change over an already-shipped ticket, or silently discarding a
real, tested bug fix.

## Questions for the specifier

1. Does the retirement ruling extend to the **code**, not just the ticket
   YAML — i.e. was BL-1248's shipped "runs but declines to write" shape a
   deliberate choice that should stand over BL-1247's "gate in front of
   sweep!" shape? Or was the hardener's re-litigation of that design
   correct and BL-1248 needs a follow-up?
2. Regardless of (1): should the duplicate-`master_main_reconcile_enabled`-key
   fix in `swarmforge.conf` land on its own (it is a real, independently
   verified defect on the already-shipped BL-1248), and if so under which
   ticket id?

`b617a292e6` remains reachable on the hardener worktree/branch, unmerged
anywhere else, pending this ruling.
