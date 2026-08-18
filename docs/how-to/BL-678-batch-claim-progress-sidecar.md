# BL-678: The Batch-Claim Progress Sidecar

**Every batch-mode claim (cleaner, hardener) now writes a progress sidecar
the instant it is claimed, so a healthy in-flight batch parcel is never
indistinguishable from a lost one — and the chase sweep can only ever
*surface* a stale one to the coordinator, never re-forward or re-deliver it.**

## The Problem This Fixes

Before BL-678, a batch-mode claim (`ready_for_next_batch.bb`) wrote no
progress record at all. On 2026-07-25, a cleaner batch claim sat mid-run
with no visible sign of life; the coordinator, chasing what looked like a
stalled parcel, nearly re-forwarded a duplicate at 16:47 — stopped only by a
human. [BL-648](BL-648-relaunch-resume-orphan-claims.md) fixed the
**dead-owner** half of that same near-miss (a claim left behind by a session
that no longer exists, caught at relaunch). This fixes the **live-owner**
half: a claim whose owner is still alive and working, mid-run.

## What Happens Now

1. **Claim time.** The instant `ready_for_next_batch.bb` claims a batch
   parcel, it writes a sidecar next to the claim file:
   `<in_process-file>.batch-claim-progress.json`, naming the owner role,
   parcel id, claim instant, last-progress instant, and last-seen commit.
   This happens unconditionally at claim time — never lazily on a later
   sweep tick, which is exactly the gap that let the 07-25 near-miss happen.
2. **Sweep time.** `handoffd`'s `batch-claim-progress-sweep!`
   (`chase_sweep_lib.bb` / `handoffd.bb`) periodically compares each held
   batch item's owning-worktree `HEAD` against the sidecar's last-recorded
   commit:
   - **Commit advanced** → the sidecar's `lastProgressAtMs` refreshes. The
     item is healthy; nothing else happens.
   - **No advance, but still under `batch_claim_progress_stale_threshold_minutes`**
     → nothing happens; this is normal mid-task quiet time.
   - **No advance past the threshold** → the item is a **suspect**. The
     sweep surfaces a `note` (priority `00`) to the coordinator naming the
     item and its age — it never re-forwards or re-delivers the parcel
     itself. A repeat-stale item is re-surfaced at most once per
     `batch_claim_progress_cooldown_minutes`, not on every sweep tick.

The suspect note reads like:
```
<parcel-id> batch claim stale <N>m since progress, not re-delivered.
```

## What This Deliberately Does Not Do

- It never becomes a liveness oracle for a **dead** owner — that is
  [BL-648](BL-648-relaunch-resume-orphan-claims.md)'s relaunch-time orphan
  sweep. This mechanism assumes the owner is alive and only ever answers
  "is it progressing", not "is it alive".
- It never touches BL-528's task-mode claim-idle escalation ladder
  (nudge → bounce → halt). Batch-mode staleness only ever surfaces a note;
  it never bounces or halts anything.
- The sidecar is cleaned up automatically when the batch completes — it's
  registered in `handoff_lib.bb`'s sidecar suffixes, so the existing
  terminal-cleanup convention removes it for free.

## Configuration

Both are in `swarmforge.conf`, commented out by default (absent, malformed,
zero, or negative all degrade to the built-in default):

```
# config batch_claim_progress_stale_threshold_minutes 20
# config batch_claim_progress_cooldown_minutes 30
```

- `batch_claim_progress_stale_threshold_minutes` — how long a batch item's
  sidecar can show no progress before it's surfaced as suspect. Default 20
  minutes.
- `batch_claim_progress_cooldown_minutes` — the minimum gap between repeat
  suspect notes for the *same* still-stale item. Default 30 minutes.

## Verifying On A Live Batch

1. Watch a batch role (e.g. `cleaner`) claim two or more parcels; confirm a
   `.batch-claim-progress.json` sidecar appears next to each claim in
   `inbox/in_process/` immediately.
2. Let the role commit progress; confirm the sidecar's `lastProgressAtMs`
   and `lastCommit` advance on the next sweep tick.
3. Trigger a chase sweep mid-batch: confirm no re-forward happens and no
   duplicate lands, sidecar or not.
4. Freeze the batch role past the staleness threshold: confirm the
   coordinator receives a named suspect note, and the parcel is still not
   re-delivered.

## Scope

- Batch-mode claims only (cleaner, hardener) — task-mode roles are
  untouched; see BL-528 for their claim-progress escalation ladder instead.
- Mid-run only — see [BL-648](BL-648-relaunch-resume-orphan-claims.md) for
  the launch-time dead-owner sweep.

## See Also

- **BL-648** — the dead-owner half of the same source near-miss, handled at
  relaunch time.
- **BL-528** — task-mode claim-idle escalation ladder (nudge → bounce →
  halt), deliberately untouched by this ticket.
- `swarmforge/scripts/batch_claim_progress_lib.bb` — sidecar shape and
  decision logic (`decide-batch-claim-observation`).
- `swarmforge/scripts/chase_sweep_lib.bb` / `handoffd.bb` — the sweep and
  the coordinator-facing suspect note.
