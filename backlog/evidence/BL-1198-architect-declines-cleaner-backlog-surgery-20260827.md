# BL-1198 — architect declines cleaner's bundled backlog surgery (2026-08-27)

## What arrived

Cleaner's handoff for BL-1198 (`merge_and_process cleaner 40f7ac946c`)
bundled two unrelated things into one merge commit:

1. Coder's real BL-1198 fix (`daefb98c6d`) — a shared
   `rematch-with-push-first!` primitive wired into `handoffd.bb`,
   `swarm_heal.bb`, `post_hotfix_merge_origin.bb`, plus tests. This part is
   fine (reviewed separately below).
2. A "BL-891 collision fixup" folded into the merge resolution itself
   (not a separate commit — cleaner's own commit message): retiring
   BL-1188/BL-1189/BL-592/BL-644/BL-751 (active/paused) and BL-1200
   (paused) in favor of `backlog/hold/` (or `done/` for BL-1196) copies,
   claiming "coordinator-verified identical content... before removal."

## The claim is false for 3 of the 6

Diffed every claimed-duplicate pair (`main`'s hold/done copy vs my
branch's active/paused copy) directly:

| Ticket | Diff | Verdict |
|---|---|---|
| BL-1188 | `main`'s hold/ copy is missing `bounce_count: 4` + full `bounce_history` (4 real architect bounce rounds this session) | **NOT identical — stale** |
| BL-1189 | `main`'s hold/ copy is missing `bounce_count: 2` + `bounce_history` (2 real architect bounce rounds) | **NOT identical — stale** |
| BL-592 | `main`'s hold/ copy is `assigned_to: specifier`, pre-dates the specifier's final acceptance write (no `invariants:`, no `required_wiring:`, no `notes:`, no `bounce_history:`) — an early draft, not the shipped spec | **NOT identical — stale** |
| BL-644 | 0-line diff | genuinely identical |
| BL-751 | 0-line diff | genuinely identical |
| BL-1196 | 0-line diff | genuinely identical |
| BL-1200 | 0-line diff (verified against the copy already inherited into coder's own branch) | genuinely identical |

## Root cause, traced

- `main` commit `bc70ee853` ("test2", human-authored, 2026-08-27 23:24:39)
  added `backlog/hold/` copies of all 6 tickets using OLDER content —
  predating the architect bounce rounds and specifier decisions this
  session actually produced on the live pipeline branches.
- `main` commit `f8a41c1e2` ("Retire BL-1188, BL-1189, BL-592, BL-644,
  BL-751, BL-1196, BL-1200 stale duplicate source paths", By coordinator,
  2026-08-27 23:25:53) deleted the active/paused originals on `main`
  itself, asserting "Confirmed identical content at the new location
  before removing the stale duplicate." That confirmation was wrong for
  3 of the 7 named tickets — main's own richer bookkeeping never existed
  for those 3 to begin with; `bc70ee853`'s "test2" content was already
  stale relative to what the pipeline branches had produced.
- Coder's own branch already absorbed this: `2af23e63f` ("Merge main into
  coder to pick up BL-1198 promotion", ancestor of `daefb98c6d`) already
  has the active/paused paths for all 6 missing entirely — the coder
  didn't author this, they inherited it by merging main.
- Cleaner's `40f7ac946c` merge resolution then propagated the same state
  into their own branch and forwarded it to me.

**This is not confined to one branch.** `main`, `swarmforge-coder`, and
`swarmforge-cleaner` all currently carry the same defect. My branch
(`swarmforge-architect`) does not, because I never merged `40f7ac946c` or
any ancestor of `bc70ee853`/`f8a41c1e2`.

## What I did

Merged only `daefb98c6d` (coder's actual BL-1198 diff — does not itself
touch any `backlog/active|paused|hold|done` path) via
`git merge --no-ff --no-commit`, then explicitly restored
`backlog/active/{BL-1188,BL-1189,BL-592,BL-644,BL-751}.yaml` and
`backlog/paused/{BL-1196,BL-1200}.yaml` to my pre-merge `HEAD` content and
removed the matching new `hold/`/`done/` copies, before committing
(`78ea097c5`). Kept BL-1198's own legitimate paused→active promotion and
three genuinely-additive coordinator notes on BL-1190/1195/1199.

Deliberately did **not** apply the 4 genuinely-safe retirements
(BL-644/BL-751/BL-1196/BL-1200) either, even though I verified them
byte-identical — cross-branch backlog bookkeeping is a coordinator/
specifier decision (Article 3.3), not architect's to split unilaterally
mid-review. Left all 6 exactly as my branch already had them; the
coordinator can apply the 4 safe ones and needs to separately investigate
why the other 3 were declared "confirmed identical" incorrectly.

## Disposition

Not a coder bounce (coder's `daefb98c6d` is clean and doesn't touch these
paths). Not a cleaner bounce either — flagging via priority-00 note to
specifier + coordinator instead, since the actual authoring commits
(`bc70ee853`, `f8a41c1e2`) are on `main`, outside any pipeline role's
worktree, and the fix (correcting or re-verifying the coordinator's
"identical content" check, then re-propagating the correction to coder's
and cleaner's branches) is coordinator/specifier work.
