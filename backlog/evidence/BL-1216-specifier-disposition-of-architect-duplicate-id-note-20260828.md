# BL-1216 — specifier disposition of the architect's duplicate-id note (2026-08-28)

## The note

Priority `00`, architect → specifier:

> main f8a41c1e2 wrongly retired BL-592/1188/1189, see b165118f0

Backing evidence: `backlog/evidence/BL-1198-architect-declines-cleaner-backlog-surgery-20260827.md`
(commit `b165118f0`), which diffed each claimed-duplicate pair and found three
of seven were not identical at all.

## Verdict on the reported half: correct, and already remediated

The architect's finding is confirmed. It is also already fixed: coordinator
commit `779a036e5` ("Correct BL-891 fixup: restore BL-1188/1189/592 with real
content, not stale") restored all three to `backlog/active/` on local `main`.

Verified independently here, not taken on the commit message:

| Ticket | Path on `main` | Real content present | Byte-identical to `swarmforge-architect` |
|---|---|---|---|
| BL-1188 | `backlog/active/` | `bounce_count: 4`, `bounce_history` | yes |
| BL-1189 | `backlog/active/` | `bounce_count: 2`, `bounce_history` | yes |
| BL-592  | `backlog/active/` | `invariants:`, `required_wiring:`, `notes:`, `bounce_history:` | yes |

Nothing is outstanding on the three tickets the note names. No re-spec, no
amendment, no send-back.

## The half nobody has fixed: four tickets left in the wrong pool

`779a036e5` left the other four "as-is" because their contents were verified
byte-identical. Content identity was never the whole question. The resolution
kept the copy that commit `bc70ee853` had added, and that copy was in a
different **pool** — and the pool is the ticket's lifecycle state.

Reconstructed by diffing `bc70ee853^` against `main`:

| Ticket | Pool before | Pool now | Consequence |
|---|---|---|---|
| BL-644  | `backlog/active/` | `backlog/hold/` | frozen; Article 3.1 forbids auto-promotion out of `hold/` |
| BL-751  | `backlog/active/` | `backlog/hold/` | frozen, same |
| BL-1200 | `backlog/paused/` | `backlog/hold/` | frozen; `type: defect`, `status: todo` |
| BL-1196 | `backlog/paused/` | `backlog/done/` | silently closed; `type: defect`, `status: todo`, never worked |

Two tickets that were **active** and two that were **paused** are out of the
pipeline. `backlog/hold/` is human-held (Article 3.1, and `backlog-schema.md`:
"a human-only park no coordinator may release"), so three of the four cannot
be recovered by the coordinator at all.

`bc70ee853` is authored by the human (Laurent Decorps) with the commit message
`test2`: 788 insertions, zero deletions, adding seven duplicate files. Its
shape reads as a scratch commit rather than a deliberate decision to freeze
four live tickets — but that is an inference, not a fact, and the specifier
already has one clarifying question pending (`role_ask.bb` allows one), so it
was not asked. **A human must confirm the intent before the four are moved
back.** Recorded here rather than guessed.

## Two further facts, recorded not actioned

- **The repair is unpushed.** `git rev-list --left-right --count main...origin/main`
  is `2 0`: `779a036e5` and `09f46574c` are local-only. `origin/main` still
  carries the bad state — BL-1188, BL-1189 and BL-592 are still in
  `backlog/hold/` there and absent from `backlog/active/`. Any role that
  merges `origin/main` rather than local `main` re-inherits the deletion.
  Pushing `main` is not the specifier's to do.
- **`master` is not implicated.** No `backlog/hold/` copy of any of the seven
  exists on `master` or `origin/master`, so the `master`↔`main` reconcile is
  not the source. `bc70ee853` is.

## Disposition

1. Reported half — confirmed fixed, closed with no action.
2. Mis-pooled half — surfaced to the coordinator by `note`; needs a human for
   the three in `hold/`.
3. Systemic gap — minted as **BL-1216**: a DUPLICATE-ID finding must name each
   colliding path's pool and its live-or-terminal classification, state whether
   the files' contents differ, and name the live copy as the one to keep. Both
   halves of this incident were a resolver guessing at facts the finding never
   printed.

By specifier.
