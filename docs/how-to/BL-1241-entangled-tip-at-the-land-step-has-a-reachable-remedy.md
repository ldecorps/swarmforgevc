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

  `<new-commit>` may also carry one `PASSENGER_SIBLING <ticket-id>` line per
  APPROVED unlanded sibling whose own lines rode in on a shared path this
  replay had to take whole — see
  "An approved sibling can ride as a passenger, guarded before publish
  (BL-1375)" below. QA owes each named passenger the same
  `abandoned_commits:` bookkeeping its own land would have produced.

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

(Narrowed by BL-1375, below: this refusal now applies only when the
unlanded co-owner is itself withheld, awaiting approval, or unreadable — an
APPROVED unlanded co-owner rides as a passenger instead.)

```
land-step: refusing to replay <ticket> - <path> is shared with unlanded
sibling(s) <sibling-ids>, and a replayed path is taken whole, so landing it
would carry the sibling's lines into main (BL-1332/BL-1375)
```

This sits ahead of BL-1315's exclusion check in `own-paths`'s `cond`, so a
shared-with-unlanded path is caught before it could otherwise be reasoned
about as sibling-only or landing-only. Everything else is unchanged: a
landing-only path still replays whole, a sibling-only path is still excluded
(BL-1315), a path shared with an ALREADY-landed sibling still replays
(`LANDED_SIBLING`, BL-1272), an unattributed path still replays, and an
unreadable attribution still refuses first.

(As of BL-1375, "shared with unlanded sibling(s)" in the refusal message
means specifically a co-owner that is withheld, awaiting approval, or
unreadable — see the next section but one, below, for the narrowed rule and
the passenger it now lets ride instead of refusing.)

## A shared path no longer hides a landed sibling behind a co-owner's unlanded lines (BL-1354)

`sibling-landed?` (above) decides whether a sibling's attributed content is
already on `origin/main`. Before this ticket, `landed-siblings` answered that
per PATH by whole-blob equality: `(= (blob-at commit p) (blob-at
origin-main p))`. On a path only one ticket touches that is exactly right;
on a path several tickets touch, every co-owner's edits are baked into the
same blob, so while ANY co-owner's lines are still unlanded the shared
file's blob differs from `origin/main` for every co-owner — including
siblings whose own lines are fully landed. The more tickets share a hot
file (`docs/reference/Specification.MD`, `docs/index.md`, cross-ticket
backlog yaml/topics are the recurring offenders), the more mutually-blocking
false-unlanded verdicts it produced. Reproduced live on BL-1332's own land
(2026-09-03): all six siblings `LAND_ESCALATE` named as unlanded were
already in `backlog/done/`; QA hand-built the tip-pure commit rather than
trust the tool.

The fix is scoped to the sibling's OWN attributed lines, not the whole file
blob — BL-1272's invariant that landed stays a positive finding, and every
unanswerable case still fails closed, is unchanged and unrelaxed.
`sibling-landed?`'s public shape (`{:paths :complete? :same-content?}`) and
`attribution-complete?` are untouched; what changed is what
`landed-siblings` injects as `same-content?`:

- `diff-line-changes` parses a unified diff into per-path `{:added
  :removed}` line sets.
- `sibling-own-line-changes` merges those across the sibling's own
  NON-MERGE commits only — a merge authors no lines, and its first-parent
  diff is everything its second parent brought in regardless of author, so
  crediting a merge's lines to the sibling was inflating attribution and had
  charged one ticket's own still-unlanded lines to an unrelated sibling.
  `nil` (an unread diff) still propagates rather than being read as "no
  change".
- `sibling-path-verdict` scores each of the sibling's own paths
  three-valued against what survives at the tip: `:landed`, `:unlanded`, or
  `:vacuous` (the sibling has nothing left of its own at that path — a line
  it once added was since rewritten by a later commit — so the path is
  silent rather than an obstacle).
- `landed-siblings` drops the `:vacuous` paths before scoring; a sibling
  left with nothing but vacuous paths still reports unlanded through the
  existing empty-paths fail-closed row — silence is never scored as
  evidence.

Regression against the real repository, same commit BL-1332 escalated on:
before the fix, all six named siblings reported unlanded; after, five
(`BL-1056`, `BL-1271`, `BL-1340`, `BL-1341`, `BL-1343`) report landed and two
(`BL-1317`, `BL-1323`) still correctly report unlanded — checked by hand and
confirmed as real content differences (a file genuinely absent from
`origin/main`, and a path renamed between the cited tip and `origin/main`,
which is not answerable by content-at-a-path and fails closed rather than
guessing).

This changes only what the detector CONCLUDES, not where it runs or what it
outputs — `land_step_cli.bb`'s `LAND_CLEAN` / `LAND_REPLAY` / `LAND_ESCALATE`
shape, and the `LANDED_SIBLING` / `ENTANGLED_SIBLING` lines, are unchanged.
Wiring this same detector into the mandatory land-step decide path is
BL-1309, a separate ticket, not built here. Acceptance:
`specs/features/BL-1354-a-shared-path-does-not-hide-a-landed-sibling.feature`.

## An approved sibling can ride as a passenger, guarded before publish (BL-1375)

BL-1332 (above) made a path shared between the landing ticket and ANY
unlanded sibling refuse outright. That is circular exactly when every
co-owner is otherwise approved: each refuses because the others are
unlanded, and none of them can go first, so a whole family of siblings that
share one hot file (`docs/reference/Specification.MD`, `docs/index.md`,
cross-ticket backlog yaml — the same files BL-1354 names) could deadlock the
land queue on that one shared path indefinitely. Reproduced live on
2026-09-03: `BL-1296`, `BL-1309`, `BL-1356` and `BL-1359` all shared a path
and all four `LAND_ESCALATE`'d against each other.

Per the human's ruling (option 1 of two offered for BL-1332's refusal —
option 2, splitting a shared path per-hunk, remains a follow-up slice, not
built here) plus the human's rider on that ruling: `own-paths`' shared-path
check now asks **which** unlanded co-owner it is, via a new
`ticket-approval-state` (`land_step_lib.bb`):

| sibling state | rides as a passenger? |
|---|---|
| `human_approval: approved` | yes |
| `human_approval` absent | yes — `swarmforge/backlog-schema.md` defines absent as "no approval needed", the same reading `promotion_gates_lib.bb`'s own promotion gate already uses (`read-human-approval`, reused here rather than re-implemented) |
| present and not `approved` (pending / amending / rejected / unrecognised) | **no** — still refuses |
| filed in `backlog/hold` | **no**, regardless of what `human_approval` says — the folder decides ahead of the field, since a held ticket can still read a pre-hold `approved` |
| found in no tree, filed in more than one backlog folder, or otherwise unreadable | **no** — fails closed |

Both the worktree and `origin/main` are consulted for each sibling (a
sibling's ticket file *moves* on `main` when it lands, and `backlog/done/`
nests by milestone, so both readers recurse), and either tree saying
blocking blocks — nothing one tree says can read away a hold the other is
carrying. Only a POSITIVE read of "approved" (or "no approval needed")
narrows anything; every other or unknown state keeps BL-1332's refusal
exactly as before.

A path landing on the passenger side is still taken whole — `own-paths`
returns the passenger sibling id(s) alongside the path set (`:passengers`),
so `land_step_cli.bb` prints one `PASSENGER_SIBLING <ticket-id>` line per
approved unlanded sibling whose lines rode in, and QA owes each one the same
`abandoned_commits:` bookkeeping its own land would have produced — a
passenger is not a bystander, its content just reached `main` on someone
else's commit.

### The rider: the replayed tree is guarded before it can be published

Letting an unapproved sibling's lines ride sight-unseen is exactly the
BL-1324 shape (an unregistered feature-file step handler landing on `main`
and jamming every subsequent commit). The human's rider on this ruling
closes that: `replay!` runs `check_feature_handler_registration.sh` against
the tree it just built, **only when at least one passenger actually rides**
— with nothing riding, the tree is this ticket's own content already
destined for `origin/main`, and guarding it anyway would make an
already-inconsistent `main` start refusing every land, trading one deadlock
for another. A guard refusal at this point aborts the whole replay (`{:success
false ...}`, naming the passengers and the refusal) rather than publishing a
now-known-bad tree.

`check_feature_handler_registration.sh` gained a `--assume-main` flag for
this call. The replay tree stands on a scratch `land-replay/...` branch, not
`main`, so without the flag the guard's own branch gate would exit 0 on the
branch *name* alone and the land would collect a pass it never actually
performed — the exact vacuous-guard shape this rider exists to prevent. The
flag only ever makes the guard **run** where it would otherwise have
skipped; it never changes what the guard decides once it runs. The guard
list (`replayed-tree-guards` in `land_step_lib.bb`) is a plain `def`, so
adding a second tree guard later is one list entry, not a second call site,
and each guard runs as its own process with its own status collected
individually (BL-1242/BL-1252's shape, satisfied by construction).

None of this changes `land_step_cli.bb`'s three top-level outcomes —
`LAND_CLEAN`, `LAND_REPLAY <branch> <new-commit>`, `LAND_ESCALATE` — only
what can follow a `LAND_REPLAY` (an added `PASSENGER_SIBLING` line per
approved rider) and what `own-paths`/`replay!` decide about a shared path
that used to be an unconditional refusal. Acceptance:
`specs/features/BL-1375-approved-siblings-sharing-a-path-can-land.feature`.

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
