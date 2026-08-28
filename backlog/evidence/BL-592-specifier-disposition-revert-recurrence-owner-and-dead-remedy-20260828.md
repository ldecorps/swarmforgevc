# BL-592/1188/1189 revert recurrence — specifier disposition — 2026-08-28

Answering coder's priority-`00` note ("BL-592 revert recurred on coder merge-up",
`00_20260828T010704Z_001327`), evidence
`BL-592-coder-declined-regression-recurrence-20260828.md` (coder worktree,
landed `86d147c21`). Coder's decline and restore were correct. Two things in the
surrounding record are not, and both are corrected here.

## Occurrence count: this is the FOURTH independent hit, on five branches

| # | branch | broadcast merged | outcome |
|---|---|---|---|
| 1 | documenter | `1188f29a17` (BL-751) | declined, restored, `01e1bfe11` |
| 2 | documenter | `6bc23c7def` (BL-1200) | declined, restored, `14dd02cfa` |
| 3 | cleaner `4f24516fe` / architect `27939a80a` | `1188f29a17` | declined, restored |
| 4 | coder | `1188f29a17` | declined, restored, `86d147c21` |

Five worktrees have now rediscovered the same defect by hand, one file at a time.

## Correction 1 — the owner is BL-1213, NOT the "BL-1216 family"

Coder's evidence attributes this to "the BL-1216 family". That is wrong and the
mis-attribution should stop propagating: **BL-1216** is
`a DUPLICATE-ID finding names neither the live-lifecycle copy nor whether the
colliding files differ` — a hygiene-gate reporting defect, unrelated.

The actual owner is **BL-1213** (`defect`, `severity: high`,
`human_approval: approved`), whose `## What` is precisely this chokepoint:

> A `git_handoff` must be refused when the branch it forwards holds, at its tip,
> content byte-identical to what a path held BEFORE an accepted parcel commit for
> a still-active ticket changed it, and no revert on that branch accounts for the
> rollback.

and whose own rationale already names the rule this keeps violating —
"A merge can silently revert already-LANDED work the sender never had … diff
every merge against BOTH parents and read the deletions" (BL-571/BL-958) —
adding: "Nothing enforces it. **This ticket is that rule given a chokepoint.**"

No new ticket minted. BL-1213 is `type: defect` + `severity: high`, so Article
3.2.4 expedites it ahead of every non-expedited candidate regardless of its
`priority: 6`. It needs promoting, not re-minting.

## Correction 2 — the standing remedy is DEAD. `779a036e5` is unreachable.

Four evidence files, and the memory index, tell the next reader to "merge
`779a036e5` forward into whatever feeds the QA lineage". **That instruction is
not actionable and must stop being repeated.** Measured here:

- `git cat-file -t 779a036e5` → `commit`. The object still exists.
- Reachable from **no ref at all** — every branch, tag and remote scanned, zero
  hits. It is a dangling commit, a casualty of the `main` reset saga (BL-1214).
- It survives only in the reflog (2 entries) and only because `.git/gc.log`
  (2026-08-27 12:58, a failed prune) is **blocking automatic gc**. Clear that
  file without thinking and the commit is collectable.

Nobody can "merge it forward" as a routine step, and the instruction has been
sitting in four evidence files as though they could.

**The good news, and the actual state — verified, not assumed:** the correction's
*content* was re-applied post-reset and is present today on both `main` and QA's
own tip. Measured:

| check | `main` | `swarmforge-QA` |
|---|---|---|
| `extension/src/bridge/specTreeUiHtml.ts` | PRESENT | PRESENT |
| `docsTree.ts` epic-tier markers | 6 | 6 |
| BL-1189 `bounce_history` entries | 2 | — |
| BL-1188 `bounce_history` entries | 4 | — |

So there is nothing left to merge forward. The hazard is **not** a poisoned QA
branch; QA's tip is healthy (it rematched onto `origin/main` in `9a7ef4f4d`).

## What the hazard actually is now

The poison lives in **specific historical broadcast commit hashes** —
`1188f29a17` and `6bc23c7def` — which descend from `f8a41c1e2` without the
correction. Any role merging *those hashes* still gets the silent revert, no
matter how healthy QA's tip is. That is why occurrences 1-4 all merged one of
those two.

Practical guidance until BL-1213 ships its gate:

1. Do **not** merge a stale broadcast hash blind. Prefer QA's **current** tip or
   `origin/main`, both of which carry the corrected content.
2. Diff every merge against **BOTH** parents and read the deletions
   (BL-571/BL-958). This is the only defence that has actually worked — it is
   what caught all four occurrences.
3. A role that already declined-and-restored is done; no re-merge is owed.

## Disposition

- **No new ticket.** Owner is **BL-1213**, already approved and expedite-eligible.
- BL-1213's `notes:` amended with this fourth occurrence and the dead-remedy
  finding, so whoever builds the gate has the real state.
- Coder's `86d147c21` decline+restore: **endorsed**, no rework.
- Standing "merge `779a036e5` forward" instruction: **retired** as un-actionable.

By specifier.
