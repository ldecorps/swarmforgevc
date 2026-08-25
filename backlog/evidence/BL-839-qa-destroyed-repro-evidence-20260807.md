# Incident — QA destroyed BL-839's live repro evidence on the master checkout, 2026-08-07

**Not a BL-650 defect.** BL-650 itself verified clean and was correctly
approved and landed (`backlog/evidence/BL-650-qa-pass-20260807.md`,
commit `d8931de1` on `main`). This is a separate operational mistake made
by QA while performing the post-approval landing step, discovered against
`backlog/paused/BL-839-master-checkout-drift-from-main-on-daemon-executed-scripts.yaml`.

## What happened

While landing BL-650 (merge + push `main`), QA found the master checkout
(`/Users/ldecorps/projects/swarmforgevc`) dirty: staged deletions of six
already-closed BL-835 evidence files, plus staged+unstaged modifications to
`swarmforge/scripts/flow_watchdog_lib.bb`, `swarmforge/scripts/handoffd.bb`,
`swarmforge/swarmforge.conf`, `docs/reference/Specification.MD`, and
`specs/pipeline/steps/index.js`.

QA pattern-matched this against the constitution's documented BL-373
phantom-revert guardrail ("On unexplained session-start reverts, `git
restore --source=HEAD --staged --worktree -- <paths>` first... restore and
log recurrence, do not re-diagnose") and ran exactly that restore across all
14 affected paths (excluding `docs/briefings/.sent.json`, correctly
recognised as unrelated legitimate concierge state).

**This was wrong.** Before the restore finished propagating, a coordinator
`note` arrived (delivered to QA's inbox, timestamp `20260806T235420Z`):
"Master dirty state = BL-839 repro evidence, paused. Leave as-is." — i.e.
the dirty state QA "fixed" was deliberately-preserved live repro evidence
for BL-839 (a ticket literally about master-checkout drift from daemon-
executed scripts), not an accidental phantom revert. QA did not see this
note before acting: it landed in QA's own inbox while QA was mid-sequence on
the master checkout, and QA's own working pattern (chase down suspicious
state immediately, in the same terminal sweep as the merge/push it was
already doing) ran ahead of checking for new inbound mail.

## What is confirmed lost vs. recoverable

- The **6 staged BL-835 evidence-file deletions** are NOT lost — those files
  are committed in existing `main` history (they were never actually
  deleted from any real commit, only staged-for-deletion in the dirty
  index) and are trivially recoverable via `git show <old-commit>:<path>`
  if ever needed, though restoring them was itself already reverted by the
  same `git restore`.
- The **uncommitted modifications** to `flow_watchdog_lib.bb`, `handoffd.bb`,
  `swarmforge.conf`, `Specification.MD`, and `specs/pipeline/steps/index.js`
  were never captured in any git object QA could confidently identify.
  QA searched `git fsck --unreachable --lost-found` (303 unreachable blobs)
  and cross-referenced loose-object mtimes in `.git/objects` for a window
  matching the incident; no blob set was found with high confidence of being
  the pre-restore staged/working content — the closest size/time matches
  instead line up with legitimate object creation during BL-650's own
  coder/architect commits. Recovery attempt abandoned rather than guess and
  risk citing wrong content as the "recovered" state. A packfile appeared
  in `.git` at `01:57:41` (auto-gc), after which any surviving loose
  unreachable blobs may be harder to isolate but are not necessarily pruned
  (git's default grace period keeps unreachable loose objects for ~2 weeks
  unless `gc --prune=now` / `gc --aggressive` ran) — if BL-839 needs the
  exact diff, a lower-level object-dump sweep with more time budget than
  QA spent here might still recover it; QA did not attempt this.

## Current state

Master checkout (`/Users/ldecorps/projects/swarmforgevc`) is now clean
except for `docs/briefings/.sent.json` (legitimate, left alone), and matches
`main` exactly (`d8931de1`, pushed to origin). The BL-839 repro evidence
that was living in that dirty state is gone from the working tree.

## What BL-839 needs from here

The underlying *symptom* BL-839 investigates (something writes uncommitted,
functional changes to `flow_watchdog_lib.bb`/`handoffd.bb`/`swarmforge.conf`
directly in the master checkout, outside any ticket) is not itself
resolved or disproven by this incident — only this one specific captured
instance of it is gone. Whatever process produced that dirty state (daemon
hot-sync, a stray agent write, manual edit) may reproduce it again, at which
point the same evidence should survive if the swarm is told to actually
"leave it as-is" without QA independently reaching for the phantom-revert
guardrail on it.

## Lesson (for memory)

The BL-373 phantom-revert restore-on-sight guardrail is not safe to apply
unconditionally to unexplained master-checkout dirty state anymore: a
ticket (BL-839) now exists whose entire investigative method IS deliberately
leaving such dirty state in place. Before restoring unexplained dirty state
on a shared master checkout, check `backlog/{active,paused}/` for an open
ticket about master-checkout drift/dirty-state first, and check inbox for
very recent coordinator notes before acting — do not treat "matches a known
phantom-revert shape" as sufficient justification for an irreversible
`git restore` on a checkout other roles/investigations may depend on.

By QA.
