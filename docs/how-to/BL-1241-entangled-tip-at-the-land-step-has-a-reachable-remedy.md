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

## The replay tip is now based on the full range, not the tagged merge's first-parent diff (BL-1315)

BL-1308 widened the DETECTOR only, by its own written statement, and left
the path SET itself untouched. That set — `own-paths` in `land_step_lib.bb`
— used to delegate to `task_scope_gate_lib.bb`'s `task-tagged-changed-paths`
reading `:delivered`, which for a merge is a real two-tree diff against the
merge's single first parent. Two incidents in two days showed this was
wrong in both directions on the same computation:

- **Over-inclusion** (2026-08-30, BL-1307 over BL-1300): `:delivered`
  returns everything the merge's SECOND parent brought in, whoever authored
  it — so a still-unlanded sibling riding the same role branch had its
  files enter the tip under the forwarded ticket's name.
- **Under-inclusion** (2026-08-31, BL-1298 over BL-1303): the same diff
  drops the landed ticket's OWN content whenever that content reached the
  branch *before* its own tagged merge did — exactly what a sibling's
  passenger ride does to it. Verified live on BL-1303's QA tip `ab8d10a8b3`:
  `own-paths` returned only the last hop's 20 paths and omitted every file
  BL-1303's own coder/hardener commits delivered, including the guard
  source `check_feature_handler_registration.sh` shells out to — landing
  that tip would have wired a guard with no source, failing closed on every
  subsequent commit to `main`.

`own-paths` now bases the set on the FULL `origin/main..commit` diff (a
straight two-tree diff, not a per-commit walk) instead of the tagged
merge's first-parent diff — this alone restores what the old base dropped,
because a full-range diff cannot lose content depending on which parent
edge carried it. A path is then excluded only on POSITIVE attribution:
every commit in range that touched the path is tagged, and every one of
those tags names a ticket in the run's own `unlanded-siblings` set (never
the landed ticket's own id, never a path with even one untagged touching
commit, since an untagged touch's contribution can't be told apart from
"nothing" and the two must not be conflated — invariant 1). An unreadable
attribution refuses instead of narrowing: `land-plan`'s `:escalate` reason
now names the specific path or diff `own-paths` could not read, rather than
the old generic "could not compute own paths to replay" (invariant 2).

None of this changes `land_step_cli.bb`'s output shape — `LAND_CLEAN`,
`LAND_REPLAY <branch> <new-commit>`, and `LAND_ESCALATE` plus a reason are
exactly as described above; only the tip `own-paths` computes, and the
specificity of an escalate reason, changed. A landed or byte-identical
sibling (the `LANDED_SIBLING` line, BL-1272) is still never subtracted —
`unlanded-siblings` itself is unaffected by this ticket.

## own-paths now refuses a wholesale exclusion by name (BL-1343)

BL-1315 (above) made `own-paths` exclude a path only on positive attribution
to an unlanded sibling. It left one shape unhandled: what happens when EVERY
delivered path gets excluded that way. Before BL-1343, that produced
`{:paths [] :warning nil}` — the exact same shape a tip that is genuinely
already identical to `origin/main` produces — so `replay!` reported "nothing
to commit" for both. A landing ticket whose whole contribution had just been
credited to a sibling was indistinguishable from a ticket with nothing left
to land: approved, closed, and absent from `origin/main`, with no escalation
to say so.

Reproduced live on BL-1338's approved tip `bc1a587622`: a plain two-tree diff
against `origin/main` showed eight changed paths, including BL-1338's own
step handler, yet the land step reported the empty-replay "nothing to
commit" message. The same silent-attribution mechanism BL-1272 relies on
(content that reaches `origin/main` under a replayed sibling's NEW commit
object attributes to nobody) was crediting BL-1338's own paths away.

`own-paths` now tracks every excluded path alongside the kept set. When the
loop ends with paths delivered but nothing kept, it returns a refusal
instead of a silent empty success:

```
{:paths nil
 :warning "land-step: refusing to replay <ticket> - every delivered path was
           attributed to an unlanded sibling, leaving nothing of this
           ticket's own contribution to land: <path> -> <siblings>; ..."}
```

`{:paths [] :warning nil}` now means only one thing — the tip really is
identical to `origin/main` — and a wholesale exclusion always speaks instead
of reading as a completion. The hardener's own pass on this ticket closed a
second silent-drop: the warning's path list was built with `(conj excluded
{...})`, but every pre-existing test exercised exactly one excluded path, so
a mutant that kept only the LAST exclusion (dropping every earlier one from
a multi-path refusal) survived unnoticed — a real multi-sibling exclusion
would have silently under-reported itself, the same silence this ticket
exists to remove. Scenario 03b now covers two own paths excluded by two
different siblings and asserts the refusal names both.

This does not touch BL-1272's `LANDED_SIBLING` accounting, or BL-1332 (a
shared path taken whole, carrying a sibling's line IN) — BL-1343 is BL-1332's
mirror, the ticket's own path dropped OUT, and fixes the subtraction
underneath both without relaxing either. Acceptance:
`specs/features/BL-1343-replay-drops-the-tickets-own-path.feature`.

## A path shared with an unlanded sibling refuses instead of carrying its lines (BL-1332)

BL-1315 (above) excludes a path only when EVERY owner is an unlanded sibling.
It left the opposite mix unhandled: a path BOTH the landing ticket and an
unlanded sibling own. `own-paths` decides inclusion per PATH, but
`write-tree-from-paths!` takes the whole blob at the cited commit for every
included path — there is no way to include the landing ticket's lines in a
shared file without also including the sibling's.

Reproduced live: `c65d8e6728` ("BL-1314: tip-pure replay onto origin/main")
added two `require(...)` lines to `specs/pipeline/steps/index.js` — one
belonging to the landing ticket, one to BL-1324, still mid-pipeline with its
handler file absent from `main`. The landing ticket's ownership of the shared
path pulled the whole file in, including BL-1324's line, straight onto
`origin/main`. `check_feature_handler_registration.sh` then refused every
role's commit on `main` — backlog bookkeeping included — until a specifier
adjudicated by hand.

Per the human's ruling (option 1 of two offered — option 2, replaying a
shared path per-hunk so an entangled parcel still lands its own work, is a
follow-up slice, not built here): a path whose owners include both the
landing ticket and an unlanded sibling now refuses the land outright, naming
the path, the landing ticket, and the sibling(s):

```
land-step: refusing to replay <ticket> - <path> is shared with unlanded
sibling(s) <sibling-ids>, and a replayed path is taken whole, so landing it
would carry the sibling's lines into main (BL-1332)
```

This sits ahead of BL-1315's exclusion check in `own-paths`'s `cond`, so a
shared-with-unlanded path is caught before it could otherwise be reasoned
about as sibling-only or landing-only. Everything else is unchanged: a
landing-only path still replays whole, a sibling-only path is still excluded
(BL-1315), a path shared with an ALREADY-landed sibling still replays
(`LANDED_SIBLING`, BL-1272), an unattributed path still replays, and an
unreadable attribution still refuses first.

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
