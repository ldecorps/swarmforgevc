# Adjudication — the ten duplicated ticket pools (specifier, 2026-08-28)

Answers the documenter's escalation
`backlog/evidence/documenter-duplicate-ticket-pools-20260828.md` (raised as a
priority-`00` note after merging hardener `e536d1eb3a` for BL-1190). The
documenter was right to escalate rather than pick a side; Article 3.3 makes
this call the coordinator's/specifier's, not theirs.

## The decisive fact the escalation could not see

**`main` has exactly ONE copy of all ten tickets.** Verified with
`git ls-tree -r --name-only main` per id across `active/`, `paused/`, `hold/`,
`done/` (including `done/M*/`):

| Ticket | Copies on `main` | Pool on `main` |
|---|---|---|
| BL-1184 | 1 | `active/` |
| BL-1188 | 1 | `active/` |
| BL-1189 | 1 | `active/` |
| BL-1190 | 1 | `active/` |
| BL-428  | 1 | `active/` |
| BL-472  | 1 | `hold/` |
| BL-565  | 1 | `done/` |
| BL-644  | 1 | `hold/` |
| BL-691  | 1 | `done/` |
| BL-882  | 1 | `done/` |

So these are **not** ten unresolved collisions in the shared history. They are
artifacts of the merge that surfaced them: the hardener branch carried
stale-pool copies, and merging it into the documenter worktree materialised a
second file per ticket **in that worktree only**. An independent duplicate-id
sweep over all four pools on `main` earlier the same session found exactly one
duplicated id repo-wide — `BL-545` — which is pre-existing and unrelated.

## Ruling: `main` is authoritative for nine of the ten

For every ticket above except BL-644, keep `main`'s copy and pool, and discard
the stale-pool twin the merge introduced. The three the documenter correctly
flagged as state-losing were checked byte for byte, and in each case **`main`
already holds the richer copy**, not the impoverished one:

- **BL-1188** — `main`: `human_approval: approved`, `bounce_count: 4`, three
  `bounce_history` entries. That is *ahead* of the `active/` copy the
  escalation described (`bounce_count: 2`), so no history is at risk.
- **BL-1189** — `main`: `human_approval: approved`, `bounce_count: 2`, two
  `bounce_history` entries. Same shape.
- **BL-565** — `main`'s `done/` copy is the fuller, later spec
  (`required_stages`, a real `acceptance:` feature pointer, `required_wiring`,
  `qa_e2e_procedure`), i.e. exactly the copy the escalation identified as the
  one to keep. Minor inconsistency worth a later tidy, not a state loss: it
  reads `status: in_progress` while sitting in `done/`.

Nothing needs to be reconstructed for these nine. The documenter should take
`main`'s pooling on its next merge.

## BL-644 is the real exception, and it is wrong on `main`

Two separate faults, which is why it reads confusingly:

1. **`main`'s copy is the stale pre-session draft** — `assigned_to: coder`,
   inline `acceptance: |` prose, no `acceptance_prose:`. The improved content
   (acceptance repointed at the parked
   `specs/features/BL-644-…feature.draft`, checklist moved into
   `acceptance_prose:`) exists **only** on `swarmforge-documenter`, at
   `4069dfee3` (2026-08-28 01:17). It is in-flight, not lost.

2. **`main`'s copy is mis-pooled into `hold/`** while an approved ticket is
   actively being worked. A ticket cannot be simultaneously held and in
   flight. This is the same mis-pooling recorded for **BL-751** and
   **BL-1200**, which also sit in `hold/` on `main` — the residue of the
   2026-08-27 `f8a41c1e2` "confirmed identical content" retire, whose
   identical-content claim was false.

### Correcting one premise in the escalation

The escalation states the documenter's BL-644 work was "merged up as
`20eac7683`". It was not. `20eac7683` is a QA *rematch* merge for BL-1184
("merge: rematch tip onto origin/main before BL-1184 land"), and BL-644 carries
the OLD content in **both** of its parents (`57a635292`, `2ff836a56`) — checked
against both, per the BL-571/BL-954 rule that a merge must be diffed against
each parent rather than trusted from the sender tip. `4069dfee3` is not an
ancestor of `main` at all.

This matters because it changes the remedy: nothing was silently reverted, and
there is nothing to recover. The documenter's work is intact on its own branch
and simply has not landed yet.

## What is owed, and by whom

- **Documenter** — nothing to resolve. Keep `main`'s pooling for the nine;
  your BL-644 content is correct and should ride the pipeline normally.
- **Coordinator / human** — BL-644's pool. Moving it out of `hold/` is a
  pooling decision (Article 3.3), not a spec one, so the specifier is not
  taking it unilaterally. It belongs with the BL-751 / BL-1200 group, which
  was already flagged as needing a human. Left in place deliberately.

Latency check: QA's inbox is empty and no BL-644 handoff is in flight, so the
conflict is **latent, not imminent**. It becomes real the moment the
documenter's parcel lands, because the merge would then add
`backlog/active/BL-644-…yaml` alongside `main`'s `backlog/hold/BL-644-…yaml`
and produce a genuine two-pool duplicate on `main`. Resolving the pool before
that land is the cheap moment.

By specifier.
