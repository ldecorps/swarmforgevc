# BL-1241: An Entangled Tip At The Land Step Gets A Reachable Remedy

QA sometimes finds that a parcel's own commit carries another ticket's
unlanded work as an ancestor — ordinary pipelining on a long-lived role
branch (Article 1's one-worktree-per-role rule) produces exactly this, and
the BL-506 inventory correctly says yes, that work is there. Before this
ticket, QA's only move was to bounce the parcel back to its author — but no
role can remove commits that are already ancestors of its own branch, so the
bounce named an action nobody could take. On 2026-08-28/29 this shape fired
five times and stalled every parcel it touched (BL-1227, BL-1192, BL-1201,
BL-1238, BL-1247).

## The remedy: rebuild, don't bounce

`swarmforge/scripts/land_step_cli.bb` is the tool QA now runs in place of an
author bounce. It is a thin IO wrapper over `land_step_lib.bb`'s detection
and replay — never a second implementation of BL-1192's own scope walk,
which it reuses directly (`task_scope_gate_lib.bb`'s own-paths walk, made
public with zero behavior change).

```
land_step_cli.bb <task-name> <commit> [repo-root]
```

- **`LAND_CLEAN <commit>`** (exit 0) — no entangled sibling. QA lands the
  cited commit unchanged.
- **`LAND_REPLAY <branch> <new-commit>`** plus one `ENTANGLED_SIBLING
  <ticket-id>` line per sibling still unlanded, and one `LANDED_SIBLING
  <ticket-id>` line per sibling whose own content is already byte-identical
  on `origin/main` (BL-1272) (exit 0) — a tip-pure commit was built on
  `<branch>`, replayed off `origin/main`, containing only this ticket's own
  paths. QA reviews and lands `<new-commit>` — never the originally-cited
  one — and records `abandoned_commits: [<cited commit>]` on the ticket
  (`swarmforge/backlog-schema.md`'s `read-abandoned-commits`), which is what
  keeps BL-1192's and `pre_qa_gate_lib.bb`'s own ancestry walks from
  mis-reading the deliberately severed descent.

  A `LANDED_SIBLING` line does not change what action `land-plan` returns —
  the sibling's original commit remains an ancestor, and its content may
  differ from the replay, so the action stays `:land` — only the report.
  It exists so the `entanglement-note` reaching the specifier for a genuinely
  unresolvable case names only siblings still actually unlanded, instead of
  re-litigating one a prior pass already replayed clean (the BL-1272 shape:
  two tickets cited at the same original tip, the first's replay lands, and
  the second's report used to still print `ENTANGLED_SIBLING` for it). The
  discriminator is content — the sibling's attributed paths already
  byte-identical on `origin/main` — never a subject-line grep for the
  sibling's ticket id, which would falsely clear a sibling that has only
  been minted or spec'd, not actually landed.
- **`LAND_ESCALATE`** plus a reason (exit 1) — detection or replay could not
  complete cleanly (a real conflict, an unreadable range). Per
  `swarmforge/roles/QA.prompt`, this is still not a bounce to the author: QA
  sends the **specifier** a `note` (priority `00`) naming the conflicting
  paths and stops.

The replay builds its tip-pure commit in a dedicated linked worktree, never
in the caller's own possibly-dirty worktree, and always cleans that worktree
up. The land step never pushes `origin` itself and never touches a ticket's
approval record or routing fields — QA's own land action (Article 1.8)
stays the human-observed step; this tool only produces the commit for QA to
review and land.

## Why this resolves the deadlock instead of just re-detecting it

Re-running the same detection is what implements the "land approved
siblings first" fast path for free: once a sibling lands on `origin/main`
(through ordinary land traffic, or an earlier land-step pass for that
sibling), it stops appearing in the entangled-sibling set and the next
parcel's tip lands clean — no separate code path. Run against the
2026-08-28 three-way entanglement shape (three tickets on one branch, each
entangled with the other two), running the land step once per ticket
produces three independent tip-pure replay commits — the sequence
terminates with all three landable, instead of all three bounced.

## Sibling detection walks full ancestry, not first-parent (BL-1308)

`entangled-siblings`'s candidate walk (`ancestry-commits` in
`land_step_lib.bb`) covers a commit's FULL ancestry — not a
`--first-parent` walk. The replay's own-path diff (`:delivered`) diffs a
merge against its first parent alone, so it can draw content from a
merge's second parent regardless of who authored it; a `--first-parent`
detection walk would miss a sibling whose untagged work only reached the
tip that way, naming other siblings while silently replaying that one's
files in unreported. `own-commit-changed-paths` and
`task-tagged-changed-paths` are unaffected by this — only the detector's
candidate set widened.

## What this does not change

- BL-1192's send-time gate and its range — unchanged; this ticket only adds
  a review-time consumer of its own-paths walk. See
  [BL-1192](BL-1192-pre-handoff-task-scope-gate.md).
- The 2026-08-28/29 bounces of BL-1227, BL-1192, BL-1201, BL-1238, and
  BL-1247 are not reversed by this ticket — those stand as QA's own
  historical verdicts.
- No per-ticket-branch model (option (c) in the ticket's approval context):
  that would need an Article 5 constitutional amendment and is recorded as
  a fallback, not built here.

## Testing locally

`swarmforge/scripts/test/land_step_lib_test_runner.bb` exercises
`land_step_lib.bb` directly against fixture git repos (including that
`replay!` never moves the caller's own branch, never dirties its working
tree, and leaves no stray worktree registered).
`specs/pipeline/steps/bl1241EntangledTipRemedySteps.js` drives the real
`land_step_cli.bb` end to end, backing
`specs/features/BL-1241-entangled-tip-at-the-land-step-has-a-reachable-remedy.feature`.
