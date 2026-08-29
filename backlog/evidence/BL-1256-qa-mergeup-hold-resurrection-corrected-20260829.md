# QA merge-up (BL-1256 parcel): corrected a stale hold/ resurrection for BL-1234, BL-1242, BL-1247, BL-1249

While merging documenter's `e7469390a2` (BL-1256 forward) into the QA
worktree, the auto-merge staged: `backlog/active/{BL-1234,BL-1242,BL-1247,
BL-1249}-*.yaml` deleted, `backlog/hold/{same 4}-*.yaml` added. This
reproduces the exact shape documenter's own
`backlog/evidence/BL-1233-mergeup-reverted-hold-parks-20260829.md` (also
landing in this same commit) already investigated and "fixed" by restoring
the hold/ copies — but that fix was itself wrong, and re-applying it here
would resurrect four already-closed tickets as `status: todo` holds.

## Why the hold/ copies are stale, not intentional

The park those hold/ copies came from is `44514c664` ("Move BL-1233,
BL-1234, BL-1242, BL-1244, BL-1247, BL-1249 from active/ to hold/ ...
**abandoned at init**"). The hardener already diagnosed and reversed this
exact park, as an ancestor of documenter's own branch:
`e0a3077dc` "Clear stale expedite-park hold/ copies for BL-1233, BL-1234,
BL-1242, BL-1244, BL-1247, BL-1249" — "the park was never lifted on this
branch, but each ticket kept moving on the live pipeline and is still
active/ there... Removing the stale hold/ snapshots so the upcoming QA
merge-up restores the real active/ copies with no ambiguity." Documenter's
later fix (for the BL-1233 merge-up) silently re-reverted the hardener's
own correction, restoring the stale hold/ snapshots it had just cleared —
this is the same [[hold-folder-is-mostly-expeditor-parks-not-human-holds]]
failure mode (BL-1261): the YAML got parked, the ticket kept moving anyway.

## What "kept moving" produced, verified directly against local `main`

- `git ls-tree -r --name-only main -- backlog/done/` lists all four:
  `BL-1234-property-allowlist-gate-recognises-every-red.yaml`,
  `BL-1242-merge-never-silently-drops-branch-work.yaml`,
  `BL-1247-bl593-property-generator-emits-values-its-own-contract-refuses.yaml`,
  `BL-1249-expeditor-restart-honours-the-operator-pause-marker.yaml`.
- `main` is 44 commits ahead of `origin/main`, 0 behind — these closures
  are real, just not yet pushed (BL-1257: prefer local main when origin
  lags).
- BL-1247 specifically: QA (this role) independently verified it shipped
  earlier this session — see `BL-1247-qa-confirm-shipped-noop-20260829.md`
  — and sent the coordinator its own confirm+bookkeep note, which is what
  produced `main`'s `Close BL-1247-bl593: move to done (QA-confirmed
  shipped cce70d985)`.
- BL-1249: this role also sent the coordinator its overdue bookkeep note
  this session (`Close BL-1249: move to done` is on `main`).
- BL-1234, BL-1242: closed on `main` (`Close BL-1234: move to done`,
  `Close BL-1242: move to done (QA-approved b6cb7a951b, overdue
  bookkeeping)`) via the same live-pipeline paths the hardener's note
  anticipated.

## Resolution applied to this merge commit

Kept the `backlog/active/` deletions (correct — none of the four belong
in the open pool). Removed the `backlog/hold/` additions the auto-merge
staged (incorrect — resurrects closed tickets as open holds). Left none of
the four present in this worktree's `active/` or `hold/`; their true
`done/` records live on `main` and will reach this branch when it next
syncs with `main` (master-main-reconcile / a future merge-up), not
invented here. `check_ticket_deletion.sh` (BL-901) requires the four ids
named in the merge commit message to accept the naked `active/` deletions
— done in that commit.

By QA.
