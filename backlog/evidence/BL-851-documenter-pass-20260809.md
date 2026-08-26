# BL-851 swarm-stamp-bridge-serves-sideload-apks-pre-auth — documenter pass — 20260809

Commit reviewed: `c0f41e0619` (hardener's forward, `merge_and_process hardender
c0f41e0619`), which carries architect's `1ad7a4657a` (findings NONE) and
coder's `492a920166` ("BL-851: close symlink escape in the pre-auth sideload
APK route"). Merged into this branch as `04ac45ee` before this pass ran
(ancestry confirmed via `git merge-base --is-ancestor c0f41e0619 HEAD`).

## What changed

A symlink-escape defect in `tryServeSideloadApk` (bridge pre-auth sideload
APK route) was fixed: `fs.statSync` (follows symlinks) replaced with
`fs.lstatSync` (does not) before treating a resolved path as a servable
regular file. Hardener then split both touched functions into 8 smaller
helpers to clear the CRAP <=6 gate — a behavior-preserving decomposition,
confirmed unchanged by architect's and hardener's own re-runs of every test
and acceptance scenario before and after the split.

## Doc surfaces checked

- `docs/how-to/BL-707-android-floating-overlay-companion.md` — already
  documents the sideload flow ("the bridge serves them at
  `https://bubble.musicalsifu.com/<filename>` (no bearer)"). This claim was
  true before and remains true after the fix; the fix closes an attacker-only
  path (a planted symlink inside the public dir), not anything a legitimate
  sideload download depends on. No factual claim in this doc became stale or
  incomplete — it never claimed containment guarantees that would now need
  updating.
- `docs/reference/Specification.MD` — grepped for `sideload`/`apk`: no
  mention. The sideload-APK feature itself (introduced by the earlier,
  separately-landed commit `2e65b769`, outside this parcel) was never
  specced there; this parcel is a security review/fix of existing code, not
  the feature's introduction, so it is not this parcel's place to backfill
  that gap.
- `docs/how-to/BL-848-certify-an-operator-hotfix.md` — notes BL-851's
  underlying hotfix commit still needs a `backlog/hotfix-ledger.yaml --new`
  entry once landed as a declared commit. That is hotfix-ledger bookkeeping
  (an operator/ops data file, not human-facing documentation) and is
  explicitly called out by the coder as intentionally not fixed by this
  parcel — outside documenter's remit and outside this ticket's scope
  (`out_of_scope`: "Broader bridge auth rework"; the ledger entry is
  ledger-owner/operator work, not a doc).
- `docs/diagrams/architecture.mmd` — the `BRIDGE` node is already a
  summary-level abstraction ("read routes + a small control-scoped write
  surface: ..."); it did not itemize the sideload route before this parcel
  and this parcel adds no new component, route, or boundary — only a defect
  fix and a CRAP-driven internal decomposition inside one existing route.
  No diagram update warranted.

## Verdict

NONE. No human-facing documentation requires a change for this parcel: the
fix is a pure security hardening + CRAP-compliance split with no externally
observable behavior change (confirmed independently by architect and
hardener), and every doc surface that already describes the affected route
remains factually accurate.

## Forward

`git_handoff` to `QA`, priority `00`, task
`BL-851-swarm-stamp-bridge-serves-sideload-apks-pre-auth`.

By documenter.
