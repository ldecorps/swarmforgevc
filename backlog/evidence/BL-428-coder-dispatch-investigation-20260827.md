# BL-428 — coder dispatch investigation — 20260827 17:14Z

## What was asked

Coordinator sent coder a `note` (priority 10, 17:14:08Z): "Work
BL-428-decrap-preexisting-high-crap-on-touch: read file in backlog/active".

## Finding: stale-bookkeeping re-dispatch (matches prior BL-729/BL-720/BL-611 pattern)

`backlog/active/BL-428-*.yaml` still reads `status: todo`, `assigned_to:
coder` in the coder worktree's copy — the tracker-level fields the
coordinator's dispatcher reads never advance mid-pipeline (they only move at
QA-close). The REAL parcel is a module-scoped decrap slice (paneHistory.ts)
that already completed coder → cleaner → architect → hardener → documenter
today (see the four `BL-428-*-pass-20260827.md` evidence files), and is
stuck on a documenter-flagged spec-gap, not waiting on coder. No new coder
work was started here — see prior sessions' notes on this exact stale-field
re-dispatch signature for why redoing work would be wrong.

## Finding: the specifier's claimed SG1 fix never actually landed on main

- Documenter flagged SG1 at 11:54:54Z: ticket's `acceptance:` was inline
  prose, unreadable by the pre-QA gate (BL-761), blocking forward to QA.
- Specifier replied 12:00:50Z: "BL-428 SG1 fixed: feature path on main
  `18a0dad4e`".
- Verified on `main` (repo root, HEAD `4955f4137` at investigation time):
  `git branch --all --contains 18a0dad4e` returns **nothing** — the commit
  is dangling, unreachable from any branch. `git merge-base --is-ancestor
  18a0dad4e HEAD` is **false**. The working file's own history
  (`git log -- backlog/active/BL-428-*.yaml` on main) shows only
  `28a973dfa` (the hardener's earlier commit, already on main since before
  the SG1 fix), never `18a0dad4e`. Main's current `acceptance:` field is
  still the old unreadable prose block, not the feature-path fix the
  specifier's note claims.
- The SG1 blocker is therefore still live on main; documenter cannot
  actually forward BL-428 to QA yet, contrary to the specifier's note.

## Likely cause

Plausibly a second casualty of the same shared-repo corruption documented in
[[BL-1124-property-fixture-git-env-leak-20260827]] (this session, same
worktree family): the specifier's commit landing but then being orphaned
when a ref got rewritten elsewhere in the shared `.git` (master is also a
worktree of the same shared object/ref store coder/cleaner/etc. use).
Unconfirmed — the specifier/coordinator have visibility into master's own
reflog that coder does not; worth checking `git reflog show main` /
`git reflog show refs/heads/main` around 12:00–13:01Z 2026-08-27 for the
same rewrite signature (branch ref pointing to an unrelated commit, then
recovered) seen on `swarmforge-coder`.

## Recommended next step (not coder's to do — main is not coder's worktree)

Specifier: `git cherry-pick 18a0dad4e` (or re-apply its diff) onto current
main, verify `git log --oneline -- backlog/active/BL-428-*.yaml` now shows
it, then re-notify documenter to forward the already-completed paneHistory
slice to QA.

## Action taken

No new decrap slice started. Sent `note` to coordinator + specifier
(priority 00) summarizing both findings. Marking this dispatch complete —
no other legitimate coder action available until the real blocker (SG1 fix
actually landing) is resolved.
