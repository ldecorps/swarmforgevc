# BL-1300: the code the human is being asked to choose is already on `main`

**Written:** 2026-08-31, by the specifier, from an idle `ready_for_next.sh`
returning `NO_TASK`.
**Why it exists:** BL-1300 asks the human a binary question — build option 1 or
option 2 — and **option 1 is already built, merged, and live on `origin/main`.**
The `approval_context` as written describes a forward-looking choice that no
longer exists. A human tapping it today would be tapping on a false premise, so
the ticket is amended and this file is the evidence behind that amendment.

Nothing here is a bounce, and no role did anything wrong. Every individual
decision in the chain was correct; the outcome is structural.

## What was supposed to happen

BL-1300 posed two coherent shapes (pin the headroom proof and keep 44000, or
move every number to 42000). The specifier declared `ruling_options` and set
`human_approval: pending` deliberately — a re-ask, not an erased approval, since
per BL-589 the earlier 19:37 BST Approve tap could not carry *which* shape.
QA verified the coder's work green and **held the land** pending that ruling
(`d4b666a336`, `BL-1300-qa-hold-pending-human-ruling-20260830.md`). That hold
was correct.

## What actually happened

A land hold stops the *land step*. It does not withhold the *content*.

QA had already merged the coder's work into `swarmforge-QA` at `68a36bcfae`
("Merge coder BL-1300 3fe063d3ad into QA") **before** deciding whether to land.
The hold `d4b666a336` was then recorded as a commit *on top of* that merge, not
as a removal of it. And `main`'s first-parent chain **is** the `swarmforge-QA`
branch — so the next unrelated land advanced `main` straight over the held
merge, and every land since has carried it further.

Ten tickets have landed on top of it: BL-1293, BL-1307, BL-1308, BL-1240,
BL-1253, BL-1264, BL-1218, BL-1210, BL-1252, BL-1225.

## Verified on `main` and `origin/main`, not inferred

| # | Check | Result |
|---|---|---|
| 1 | `git merge-base --is-ancestor 9553cf9354 origin/main` (coder's option-1 commit, "the fix-commit Given is pinned, so 44000 is the only live budget") | **YES** |
| 2 | `git merge-base --is-ancestor 3fe063d3ad origin/main` (its self-audit follow-up) | **YES** |
| 3 | `origin/main:specs/pipeline/steps/bl1227BootPrefixLiveBudgetCheckSteps.js` | contains `fixCommitTree()`; line 154 binds *the repository at the BL-1227 fix commit* to the materialized tree, not `undefined` — **this is option 1's whole deliverable** |
| 4 | `origin/main:extension/test/bl1300HeadroomProofIsPinned.test.js` | **present** (it was absent when QA wrote its hold — that absence was check 4 of QA's own report) |
| 5 | `origin/main:extension/test/bl1300SingleEnforceableBudget.property.test.js` | **present** — the declared invariant's property test |
| 6 | `node specs/pipeline/cli.js specs/features/BL-1227-boot-prefix-live-budget-check.feature` on the live tree | **7/7 pass** |
| 7 | `git log --oneline --first-parent main` | `68a36bcfae` sits at position 33, with ten lands above it |

So option 1 is not partially present or phantom — it is complete, tested and
enforcing.

## The hold also silenced its own question

The coordinator moved BL-1300 `active/` → `backlog/hold/` at `aeea3fa6dc`,
correctly, acting on the specifier's own note asking for a free slot for the
night shift.

But the approvals sweep never looks in `hold/`:

- `extension/src/concierge/pendingApprovalsAnnouncementHook.ts:25` iterates
  `for (const folder of ['active', 'paused'])`.
- `:67` calls `computeNeedsApproval(folders.active, folders.paused)`.
- `extension/src/metrics/backlogDashboard.ts` has **no `hold` member at all** —
  its `folders` type declares `active`, `paused`, `done` only (`:53-54`, `:240-241`).

So since `aeea3fa6dc` the ticket has been waiting for a tap that is no longer
being requested from anyone. `hold/` means two different things at once — "a
human is sitting on this" and "do not ask the human about this" — and BL-1300
needed the first while receiving the second.

## What the ruling now actually decides

The question is still live and still the human's; only its consequences moved.

- **Option 1** — no longer "build it": *confirm what is already running.* Cost:
  a bookkeeping close. `boot_prefix_budget_gate.sh`, the standing runner and the
  failing report already all name 44000, and BL-1227's feature is 7/7.
- **Option 2** — no longer "build the wider one instead": *revert live,
  exercised code and then build the wider one.* Cost: reverting `9553cf9354` and
  `3fe063d3ad` off `main`, plus the original option-2 scope (`boot_prefix_budget_gate_lib.bb`'s
  `(def budget 44000)` and its header, `boot_prefix_budget_gate.sh`'s header,
  `docs/index.md`, `docs/how-to/BL-859-boot-prefix-budget-gate.md`, and the
  specifier-prompt sentence the specifier lands itself), plus adding
  `documenter` to `required_stages` as the ticket's own notes already flag.

Option 2 remains entirely defensible — 42000 is the ceiling that has in practice
prevented a sixth overrun — and this file must not be read as an argument for
option 1. It is an argument for the human being told the true price of each
before tapping.

## What is owed, and by whom

1. **Human** — the ruling, now with accurate costs. It cannot be requested while
   the ticket is in `hold/` (see above), so either the ticket returns to
   `paused/` (Article 3.1: moving out of `hold/` is a human action, not the
   coordinator's or the specifier's) or the human is asked directly.
2. **Nobody re-does the work.** Under option 1 there is nothing to build. Under
   option 2 the revert is scoped work, not a bounce against the coder — the
   coder built exactly what the specifier's `How` section listed first, and did
   it correctly.
3. **The structural defect is minted separately** — a QA land hold that leaves
   its content on the branch `main` is advanced from is not a hold at all, and
   this is the second instance in two days (BL-1307's park landed the same way,
   as did BL-1295's on 08-30). BL-1308 widened the *detector* for replay-based
   lands; it cannot see this path, because no replay is involved.

By specifier.
