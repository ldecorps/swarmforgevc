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
  complete cleanly (a real conflict, an unreadable range). Whenever the
  escalate carries positive evidence of an unlanded sibling — including an
  attribution the step could not read at all (BL-1343's fail-closed case) —
  it prints the same `ENTANGLED_SIBLING <ticket-id>` lines and
  entanglement note a `LAND_REPLAY` would (BL-1463): naming never depends
  on which action follows, only on whether the evidence exists. An
  escalate with no such evidence (an unreadable range, "task name names no
  ticket id") stays bare, reason only. Per `swarmforge/roles/QA.prompt`,
  this is still not a bounce to the author: QA sends the **specifier** a
  `note` (priority `00`) naming the conflicting paths and stops.

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

## A sync merge is not credited with its passengers (BL-1374)

`own-commit-changed-paths` (`task_scope_gate_lib.bb`) answers a merge's
`:delivered` diff against its FIRST parent alone — which is everything the
SECOND parent brought in, whoever authored it. `path-owner-tickets`
(`land_step_lib.bb`, feeding `own-paths`) walked exactly that view for
attribution, so a routine `git merge main` tagged with a subject naming the
ticket you're working on swept every unlanded file that sync carried into
that ticket's own path set — refusing a land over an entanglement that
wasn't real. Reproduced on the tip that produced this ticket's report
(`5d4486eb08`, "Merge main into swarmforge-QA for BL-1309 human_approval
restore"): its `--name-only` list held BL-1296's and BL-1309's ticket
files, but its combined patch held not one hunk — BL-1309's own commits
never touched BL-1296's file, and the replay refused the land over it
anyway. `sibling-landed?`'s sibling-side fix (BL-1354, above) already
carried this exact reasoning — `sibling-own-line-changes` skips merges
outright, "a merge authors no lines of its own" — but the delivered side
never got it.

The fix is `merge-authored-paths`: for a merge commit, `path-owner-tickets`
now checks whether the merge's own DENSE COMBINED diff (`git diff-tree
--cc`/`--combined`) produces a patch for the path in question — not
whether the path merely appears in its `--name-only` list. A clean
auto-merge (two sides edited different parts of the same file; the result
differs from both parents, but the merger wrote nothing) produces a
`--name-only` entry with an empty patch, and is now correctly not credited.
The one case a merge really CAN author is a genuine conflict it resolved —
that still shows up as a real hunk in the combined diff and is still
credited, so invariant 3 (never drop a path this ticket's own work
changed) holds. An unreadable combined diff is blindness, not "the merge
wrote nothing", and propagates as a read failure the same way every other
unanswerable case in this file does.

Detection (BL-1308's widened candidate walk) is untouched — a passenger
ticket is still *reported* as unlanded even once it's no longer credited as
this ticket's own path; only the credit narrowed, not the visibility. The
human's ruling (2026-09-03) took both remedies on the table: this code fix,
plus the discipline rule as belt and braces — a sync merge's subject must
still never name a ticket (standing practice already, see the workflow
article's "Never name a ticket in a main-sync merge subject" rule); that
habit stays worth keeping even with this code fix in place, since
`own-commit-changed-paths` itself — the send-time task-scope gate's own
call site — is a distinct read this ticket does not touch. Acceptance:
`specs/features/BL-1374-a-sync-merge-is-not-credited-with-its-passengers.feature`.

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
| `human_approval: approved`, but its most recent bounce record names a commit reachable from the tip with no later handoff on record (`:bounced`, BL-1466) | **no** — named with the bounce's commit and date; a later handoff citing a descendant of the bounced commit clears it. The bounce store this reads is the SHARED TARGET ROOT — `git rev-parse --git-common-dir`'s parent, the same resolution `is_qa_ancestor.sh`'s land-approval store uses (BL-1339 option 2) — union'd with the caller's own root when distinct, never narrowed to just one; a record under either counts, and an unreadable store under either blocks (BL-1470: BL-1466 shipped reading only the CALLING worktree's root, where `record-bounce.js` never writes, so every ordinary `land_step_cli.bb` invocation with no explicit root answered "never bounced" for real bounces sitting under the master checkout) |

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
individually (BL-1242/BL-1252's shape, satisfied by construction). That
prediction held twice: `check_handler_module_graph.sh` (BL-1385) joined the
same list as a second, sibling tree guard — registration is not
loadability, and it proves a handler's require graph resolves on the tree
under test, never the checking worktree's own files — and
`check_bb_scripts_load.sh` (BL-1395) joined as a third, proving every
changed `.bb` script (`handoffd.bb` specifically BOOTED, not just loaded)
survives Babashka's SCI analysis on the tree under test, after a hand-splice
at land reintroduced a defect this same class of guard now catches at
commit time too. See
[BL-1252's "A landed daemon script is booted before it is published"
section](BL-1252-commit-guard-chain-reports-every-violation.md#a-landed-daemon-script-is-booted-before-it-is-published-bl-1395)
for the guard's own mechanics.

None of this changes `land_step_cli.bb`'s three top-level outcomes —
`LAND_CLEAN`, `LAND_REPLAY <branch> <new-commit>`, `LAND_ESCALATE` — only
what can follow a `LAND_REPLAY` (an added `PASSENGER_SIBLING` line per
approved rider) and what `own-paths`/`replay!` decide about a shared path
that used to be an unconditional refusal. Acceptance:
`specs/features/BL-1375-approved-siblings-sharing-a-path-can-land.feature`.

## "Landed" made per-path-complete, and the report finally names paths (BL-1389)

BL-1354 (above) scored a sibling's own lines PER PATH but still verdicted
LANDED/UNLANDED per TICKET — any one of the sibling's attributed paths
landing (a feature file minted at spec time, an evidence file hand-landed
earlier) was enough for `sibling-landed?` to read the whole sibling as
landed, even while its handler code and other source files were still
absent from `origin/main`. Once a sibling read landed, `own-paths` let
every path attributed to it ride — under the LANDING ticket's own
approval, not the sibling's — because `LAND_REPLAY`'s report printed only
sibling ticket ids (`LANDED_SIBLING <id>`, `ENTANGLED_SIBLING <id>`), never
one path, so nothing in the CLI's own output could show a human what was
about to ride.

Reproduced live on 2026-09-04 (QA's BL-1386 land, cited commit
`2cab559722`, `origin/main` `94be289136`): `path-owner-tickets` attributed
`specs/pipeline/steps/bl1367ApprovalCarriesItsRulingSteps.js` and
`extension/src/concierge/pendingApprovalReply.ts` to BL-1367 alone — both
genuinely absent from `origin/main` — yet BL-1367 read landed (some of its
OTHER attributed paths were on `origin/main`) and both files rode into
replay `67cd1d8dd7`. The CLI printed 17 `LANDED_SIBLING` names and not one
path; QA caught it only by diffing the tip by hand.

Two fixes, both invariant-scoped rather than loosened:

- **Exclusion is now self-sufficient per path** (invariant 1): a path
  whose owners are non-empty, untagged-free, exclude the landing ticket,
  and consist ONLY of siblings whose OWN lines at THAT path are not on
  `origin/main` is excluded from the replay regardless of what those
  siblings' TICKET-LEVEL verdict reads — `sibling-own-line-changes`
  (BL-1354) is now asked per path here, not only inside the ticket-level
  roll-up.
- **The ticket-level verdict is now per-path-complete** (invariant 2):
  `sibling-landed?` reports landed only when EVERY path attributed to that
  sibling has the sibling's own lines on `origin/main` — one landed path
  can no longer carry the whole ticket. BL-1272's invariant that landed
  stays a positive, never-guessed finding is unchanged.

The report now names what it decided (invariant 3): `LANDED_SIBLING
<ticket-id> <deciding-path>` names the path the landed verdict rests on,
and a new `EXCLUDED_SIBLING_PATH <path> <ticket-id>` line prints once per
delivered path left OUT of the replay, naming the sibling it was credited
to — so a human reads the verdict off the CLI's own output instead of
re-deriving it by diffing the tip. BL-1375's passenger rule (above) is
untouched: an APPROVED sibling still rides on a path the landing ticket
also owns, after the tree guards. Acceptance:
`specs/features/BL-1389-a-path-an-unlanded-sibling-owns-alone-never-rides-another-tickets-land.feature`.

## A hand-built tip-pure land records its own approval too (BL-1405)

`LAND_ESCALATE` (above) means the tool cannot build the replay for QA — QA
builds it by hand instead (the BL-1376 recipe, BL-1386 adjudication route
1). Before this ticket, that hand-built replay skipped the one step
`land_step_cli.bb`'s own `LAND_REPLAY` path performs automatically: writing
the replay-to-approved-source mapping (BL-1334) that
`is_qa_ancestor.sh` — the babysitter's Article 4.2 sweep, the push-sweep
gate, and the commit-time guard all consult — needs to answer `approved`
for the replay. A hand-built land had no CLI reachable for it (the writer,
`record-land-approval!`, lived only inside `land_step_cli.bb`'s own
`-main`), so the published commit stood in for an approved source that
nothing recorded, and `is_qa_ancestor.sh <replay>` answered exit 1 — a
standing false-positive CRIT until an unrelated later merge closed the
window. All six hand-lands of 2026-09-04 (BL-1382, 1388, 1393, 1395, 1398,
1399) were in this state.

`swarmforge/scripts/record_land_approval.bb <project-root> <replay-commit>
<approved-source> [<ticket-id>]` is the thin CLI over that same writer
(never a second serializer of the record — `land_step_lib.bb`'s
`record-land-approval!` is the one writer either route calls). Before
reporting a hand-built land done, QA:

1. Records the mapping: `bb swarmforge/scripts/record_land_approval.bb
   <root> <replay-10-hex> <cited-approved-source-10-hex> <ticket>`. Exit 0
   prints `LAND_APPROVAL_RECORDED <replay> <- <source> (<ticket>)`, or
   `LAND_APPROVAL_ALREADY_RECORDED <replay> <- <source>` for an exact
   duplicate (idempotent — recording twice is harmless, first matching
   line wins at the predicate). A missing sha on either side refuses (exit
   non-zero) and writes nothing.
2. Reads the CLI's own printed verdict — it shells out to the SAME
   `is_qa_ancestor.sh <replay>` every other consumer calls (never a
   reimplemented check) and prints `VERDICT <replay> approved` /
   `not approved` / `undeterminable` — so QA sees `approved` before closing
   the land, in the same run that wrote the record.
3. Records `abandoned_commits: [<cited commit>]` on the ticket, exactly as
   the ordinary `LAND_REPLAY` bookkeeping above requires — a hand-built
   land owes the same bookkeeping its own `LAND_REPLAY` path would have
   produced.

A record on its own grants nothing: `is_qa_ancestor.sh` (BL-1334 section,
`swarmforge/scripts/is_qa_ancestor.sh` around the "land-step
replay->approved-source mapping" comments) still answers `approved` for a
recorded replay only when the named SOURCE is itself approved — recording
a replay against an unapproved source is written but still answers
`not approved`. The predicate and the store shape are unchanged by this
ticket; only the hand-built route gained a way to write to the same store
the ordinary route already used. Acceptance:
`specs/features/BL-1405-a-hand-built-land-records-its-land-approval.feature`.

## One land plan reads one tip, immune to a moving `origin/main` (BL-1431)

`land-plan` used to resolve `origin-main-sha` itself, then hand off to
`entangled-siblings`, `own-paths`, and `main-ticket-sources`, each of which
resolved the SAME ref by name again independently — up to five separate
reads inside one plan. On a busy repo, `origin/main` moves between those
reads: on 2026-09-05, QA's `land_step_cli.bb` runs took 3.5-4.5 minutes
each while `main` landed 14 times in half an hour (mints, approvals, topic
records — committed by the front desk and the concierge too, not only the
specifier, so a "pause minting during a land" remedy can't work). When a
mint landed between `land-plan`'s attribution-map build and `own-paths`'
own diff, the delivered diff picked up the mint's new path, looked it up
in an attribution map built on the OLD sha, found nothing, and refused
with a `could-not-read-attribution` `LAND_ESCALATE` — a refusal that is
correct for a read that genuinely failed, misapplied to a read that never
happened at all. This produced two false `LAND_ESCALATE`s on BL-1416 and
one on BL-1407 in a single morning.

`land_step_cli.bb` now resolves `origin-main-sha` exactly ONCE, at entry
(after canonicalising the commit), and passes it into `land-plan` as the
optional `:origin-main` key. `land-plan` threads that exact SHA to every
reader below it — `entangled-siblings`, `own-paths`, the per-path
attribution map, `main-ticket-sources`, sibling-landed verdicts — none of
them re-resolves the ref by name; a caller that omits `:origin-main` (the
pre-existing direct/test contract) still gets it resolved once, at
`land-plan`'s own entry, never per read. A fetch that moves `origin/main`
mid-walk now changes nothing about the verdict: the whole plan is computed
against the one tip it started with.

**The publish step is unchanged** (invariant 2): `land_main_publish.sh`
still does a single FF-only push with one rebase rematch onto whatever the
CURRENT tip is when it publishes, never a second rematch, never
`--force` — a moved `origin/main` is reconciled there, and only there, not
inside the plan's own read. **Fail-open posture is unchanged** (invariant
3): an `origin/main` that can't be resolved at entry is still the caller's
own warning, never a guessed SHA, and a read that fails mid-walk still
refuses rather than silently narrowing its own answer (BL-1389's posture,
unrelaxed). Acceptance:
`specs/features/BL-1431-one-land-plan-reads-one-tip.feature`.

The walk's own COST — why it takes 3.5-4.5 minutes at all, and the QA
branch's long history of never-landed merge commits — is the sibling
question BL-1432 poses to the human; this ticket only makes the walk
immune to a moving ref, it does not make the walk faster.

## The walk is bounded to the parcel's own base, and a clean land can re-point the branch (BL-1432)

QA's `swarmforge-QA` branch carries 1839 commits `origin/main` will never
contain (2026-09-05) — its own review merges and main-sync merges, whose
CONTENT already landed on `main` under different SHAs via tip-pure replay,
so they never become `main` ancestors and never leave the branch. Every
`land-plan` walk paid for all of them (3.5-4.5 minutes wall clock), and
the same stale history inflated `ENTANGLED_SIBLING` reports with dozens of
already-done tickets a narrower walk would never have named. Human ruling
(reopened same day, then confirmed verbatim "BL-1432: make it option 3"):
both mechanisms below, neither depending on the other.

**The bounded walk (live, no wiring change needed).** `land-plan` gained
an optional `:base` key; omitted, it computes
`task_scope_gate_lib.bb`'s new `parcel-own-base` — the same
last-handoff-commit notion the send-time task-scope gate already computes
for `parcel-own-changed-paths`, exposed as a public wrapper rather than a
second implementation — falling back to `origin-main` on a task's first
hop or an unreadable abandoned base. `entangled-siblings` and `own-paths`
each take this as their `walk-base`, bounding `ancestry-commits` and the
delivered-diff read to the parcel's own commits; `origin-main` itself is
untouched as the tree every landed/unlanded verdict is read against — only
the candidate range narrows, so a bounded walk cannot hide a real
still-unlanded sibling whose commit lies inside the parcel's own range.
Because `land_step_cli.bb` never needed to change to pick this up, it is
live today.

**The re-point (`post-land-repoint!`) is called from the publish on every
land (BL-1438).** It refuses — never running `git reset --hard` — on an
uncommitted change or a parcel still in `in_process` (checked first, since
an in-process parcel's own mailbox file is untracked and would otherwise
misreport as a generic dirty tree), each refusal named in
`.swarmforge/daemon/land-repoint.log`; on a verified-clean tree it moves
both the branch and the worktree to `origin/main` and logs the old and new
tip. `land_step_cli.bb`'s `repoint <repo-root>` verb wraps it, and
`land_main_publish.sh`'s `run_land` invokes that verb immediately after
`LAND_PUBLISHED`, before the issue close, printing whichever line the verb
prints: `LAND_REPOINTED <old> <new>` on a clean re-point, or
`LAND_REPOINT_SKIPPED <reason>` when the guards above refuse — either way
the verb exits 0 and the publish's own outcome is unaffected (a skip is a
decision, not a failure). The QA branch's on-disk history no longer keeps
growing after a clean land; the bounded walk above already stops that
growth from costing anything even when a re-point is skipped. Acceptance:
`specs/features/BL-1432-the-land-walk-ranges-over-the-parcel.feature` and
`specs/features/BL-1438-the-publish-re-points-the-qa-branch-after-a-land.feature`.

## The bounded walk never counts landed history, and a replay carries every hop's work (BL-1446)

BL-1432's bound was wrong in two ways the moment a QA branch synced
`origin/main` after its last recorded hop. Incident 2026-09-06
(`backlog/evidence/BL-1424-land-replay-dropped-own-paths-incident-20260906.md`):
`land_main_publish.sh` printed `LAND_REPLAY`, `LANDED_SIBLING BL-1445`, then
`LAND_PUBLISHED` on a tip holding five evidence files and no guard — a plan
forced to `:base origin-main` returned `{:action :land}` for the same tip.

1. **`entangled-siblings`' candidate walk never excluded anything already
   reachable from `origin-main`.** A routine post-hop `git merge
   origin/main` pulls already-landed history into `walk-base..commit` that
   `walk-base` alone cannot exclude; any of those commits naming another
   ticket became a candidate, verdicted LANDED against `origin-main`, but
   still forced the plan onto the `:replay` path.
2. **`own-paths`/`delivered-attribution` were bounded to the same
   `walk-base`,** so a forced replay's own-paths held only the commits
   after the LAST hop — dropping every coder/cleaner/architect/hardener
   commit before it, since a replay must carry the parcel's whole
   contribution, not the delta since whichever hop happened to record
   `:base`.

Fixed in `land_step_lib.bb`: `ancestry-commits` gained an optional
`exclude-also` argument (4-arity), and `entangled-siblings` passes
`origin-main` through it — a landed commit is never a candidate sibling
regardless of how it entered the `walk-base..commit` range (invariant 1).
`own-paths` and `land-plan`'s own `delivered-attribution` delay now always
read from `origin-main`, never `walk-base`, restoring `own-paths`' own
pre-BL-1432 contract ("since origin/main"). Both only run on the rare
`:replay` path — never the common `:land` path BL-1432 was bounding — so
this costs nothing on the case BL-1432 was written for. (`:base` itself
went on to stop bounding the candidate walk too, on BL-1461 below — the
bounded/wide agreement this paragraph originally leaned on became
unconditional once that landed.)

## A fourth outcome: a replay missing a parcel path is refused before publish (BL-1447)

Building a correct replay tip and PUBLISHING it were two different steps
with nothing between them checking the second followed from the first.
The 2026-09-06 incident (`backlog/evidence/BL-1424-land-replay-dropped-own-paths-incident-20260906.md`,
BL-1446's own root cause) shipped `LAND_PUBLISHED` on a replay tip holding
five evidence files and none of the ticket's actual deliverable — caught
only by QA diffing the replay against the coder's own file list by hand,
because a replay is built as a fresh commit off `origin/main` and so diffs
CLEANLY against its own parents; the Guardrails both-parents check (above)
cannot see this failure mode at all.

`land-plan` now verifies its own replay before ever returning `:replay`:
after `replay!` builds the tip-pure commit, it reads the parcel's own path
set independently — `parcel-commit-paths`, from `git log --format=%H
^origin/main <cited>` filtered to subjects naming the ticket, each
commit's `diff-tree --name-status` unioned (the wide, cheap, unbounded
read of the parcel's own history, never the attribution that built the
replay — invariant 2, so this check cannot share that attribution's blind
spot) — and compares it against the built tip via
`replay-completeness-offenders`, a pure function over the two trees'
path→blob maps (unit-testable without git). Any path the parcel changed
that the replay tip is missing, or holds a different blob for, is an
OFFENDER; a path the parcel deleted must be absent from both.

- **No offenders**: `land-plan` returns `{:action :replay ...}` exactly as
  before — `LAND_REPLAY <branch> <new-commit>`, unchanged.
- **Any offender**: `land-plan` deletes the just-built replay branch and
  returns `{:action :escalate :reason "replay-incomplete: <path>
  [<path> ...]"}` — every offending path in ONE report (Article 4.4), not
  the first found. `land_step_cli.bb` prints this exactly like any other
  escalation (`LAND_ESCALATE` then the reason on the next line), so
  `land_main_publish.sh`'s existing `LAND_STOPPED` branch stops the
  publish with no CLI or wrapper change needed.

This is the fourth `land-plan` outcome alongside `:land`, `:replay`
(complete) and the pre-existing `:escalate` for an unreadable range or a
replay that fails to build — `replay-incomplete:` is a distinct reason
prefix from those, greppable on its own. QA's interim hand-check (in force
"until BL-1447 lands," `swarmforge/roles/QA.prompt`) is retired by this
ticket landing — the check it described by hand is now this automated one.
Acceptance:
`specs/features/BL-1447-a-replay-missing-a-parcel-path-is-refused-before-publish.feature`.

## The candidate walk covers the whole parcel range, not just the last hop (BL-1461)

BL-1432's `:base` bound narrowed the ENTANGLEMENT candidate walk itself, not
only `own-paths`/`delivered-attribution` (which BL-1446 already widened
back to `origin-main`). A sibling ticket's commit absorbed into a shared
cleaner/architect/hardener/documenter branch BEFORE the parcel's last
recorded hop — the ordinary shape Article 2.6 describes — sat before
`:base` and was never visited: `land_step_cli.bb BL-1448 6c8caf27fb` and
`... d854af2126` both answered a bare `LAND_CLEAN` on 2026-09-07 while
carrying BL-1349's unlanded `bounce_history`, caught only by an unrelated
hand content-diff, then confirmed with the wide (`walk-base origin-main`)
form of `entangled-siblings`.

Fixed in `land_step_lib.bb`: `land-plan`'s own candidate range
(`entangled-siblings`' own internal walk, and the local `candidates`/
`lines-of` that feeds it) now always runs `origin-main..commit`, never
`:base` — the SAME range `own-paths`/`delivered-attribution` already used
after BL-1446. `:base` is still accepted (so `own-paths`' own
call-site-compatible trailing parameter needs no shape change) but decides
nothing: BL-1432's original invariant 3 ("bounded and wide walks agree") is
no longer a checked coincidence, it is now trivially true by construction.

BL-1432's original motive for narrowing — avoiding a walk over the QA
branch's forever-growing, never-landed history (1839 commits measured
2026-09-05) — is met a different way now: BL-1438's post-land re-point
keeps that range short (163 commits on 2026-09-07) by construction, so the
wide walk this restores costs about what the bounded one did.

Acceptance:
`specs/features/BL-1461-the-land-step-never-calls-a-tip-clean-over-an-unlanded-sibling.feature`.

## A bounced, not-yet-re-fixed sibling never rides as approved (BL-1466)

`ticket-approval-state` (above) reads only the backlog folder and
`human_approval` — a QA bounce writes `.swarmforge/bounces/<YYYY-MM>.jsonl`
(the same store `record-bounce.js`/`record-qa-bounce.js` write and
`is_qa_ancestor.sh`/`chase_sweep_lib.bb` already read) and changes neither,
so a sibling QA bounced an hour earlier still reads `:approved` and could
ride a shared path as a passenger, or have its paths counted landable.
Until BL-1438's re-point, this was masked by QA's own BL-490/495 revert
keeping the bounced content off the QA branch; the re-point (`reset --hard
origin/main` after every land) drops that revert with everything else
local-only. 2026-09-07: QA bounced BL-1450 at 11:48Z and reverted it;
BL-1447 landed and the re-point reset the QA branch to `origin/main`;
BL-1452's documenter tip, built before the bounce, still carried BL-1450's
original content, and merging it brought that content back into QA's tree
with no revert left to keep it out
(`backlog/evidence/BL-1452-QA-followup-repoint-discards-unlanded-bounce-work-20260907.md`).
BL-1452 shared no path with BL-1450, so nothing wrong actually landed —
but a ticket that DID share a path would have carried the bounced lines in
as an approved passenger, and no check would have fired.

Fixed: `ticket-approval-state` now also reads the sibling's most recent
bounce record (reusing `chase_sweep_lib.bb`'s existing reader, never a
third parser). A sibling whose latest bounce names a commit reachable from
the tip, with no later handoff of that sibling on record, answers
`:bounced :blocking? true` — blocking for every purpose BL-1375's
passenger rule serves, exclusive paths excluded, never eligible as a
passenger — and the `blocking-siblings` report names the bounce itself
(`BL-9002 bounced 2026-09-07T11:48Z at 6e517f02a3, not re-fixed`) so QA
never has to open the store by hand. A later handoff for the sibling
citing a descendant of the bounced commit clears it. An unreadable bounce
store fails closed, the same shape as BL-1375's own invariant 1; a
sibling with no bounce record on file is unaffected — BL-1375's answer for
it is exactly what it was.

Acceptance:
`specs/features/BL-1466-a-bounced-sibling-never-rides-another-tickets-land.feature`.

**Note for the record:** this ticket's own "How" names the specifier,
not the documenter, as the one who removes `QA.prompt`'s interim "Until
BL-1466 lands" hand-check block at landing.

## An escalating land step still names the sibling it could not read (BL-1463)

`land-plan`'s `(nil? paths)` branch (an attribution `own-paths` could not
read — BL-1343's fail-closed case) returned only `{:action :escalate
:reason ...}`, carrying none of the `:entangled`/`:landed`/`:unlanded`
sets the `:replay` branch two lines below does. `land_step_cli.bb`'s
`:escalate` outcome prints `LAND_ESCALATE` and the reason and exits 1 —
no `ENTANGLED_SIBLING` line (printed only on `:replay`) and no
entanglement note (printed only for a failed replay): an escalate never
named the sibling it had evidence for. BL-1272's own acceptance scenario
(row 4, an "unreadable" sibling state expected "reported") caught exactly
this and had been red since BL-1343 landed (2026-09-02) turned the
unreadable case from a narrowed replay — which named the sibling on the
replay path — into a bare escalate. Found 2026-09-07 by the coder running
BL-1447's e2e.

Fixed: the `(nil? paths)` branch now merges `(select-keys sets [:entangled
:landed :unlanded])` into its escalate map, and `land_step_cli.bb` shares
one sibling-printing function between the replay and escalate outcomes —
`ENTANGLED_SIBLING <ticket-id>` lines and the entanglement note print on
ANY escalate that carries `:unlanded`, not only on replay. An escalate
with no such evidence (an unreadable candidate-walk range, or "task name
names no ticket id") still prints bare, reason only — the earlier
`warning` escalates gain no sets. BL-1343's own refusal is unchanged: an
unreadable attribution still escalates rather than narrowing to a replay;
this ticket only adds names to that refusal. BL-1272's feature text is
untouched and its register row leaves with the fix.

Acceptance:
`specs/features/BL-1463-an-escalating-land-step-still-names-the-sibling-it-could-not-read.feature`.

## A replay never delivers a path no commit in the parcel's own range touched (BL-1473)

BL-1315 (above) based `own-paths` on the full `origin/main..commit` two-tree
diff so a full-range diff could not lose content depending on which parent
edge carried it. That same two-tree diff, though, also names every path
origin/main gained, deleted, or changed AFTER the branch forked — none of
which any commit of the parcel ever touched, and the sibling-attribution
exclusion below it never caught these either: an untouched path's
attribution reads as `owners=#{}`, indistinguishable from "touched by
nobody in particular," so it was never excluded. Three distinct shapes of
this showed up:

- **A path main gained since the fork is proposed as a deletion.**
  2026-09-07, QA evidence `BL-1463-QA-followup-two-land-step-defects-20260907.md`
  (D2): `land_step_cli.bb BL-1463 adfc35e0c8` built a 40-path replay whose
  commit the merge-deletion guard (BL-1242) refused — `backlog/paused/
  BL-1470-...yaml` and `BL-1471-...yaml` were minted on origin/main minutes
  after BL-1463's branch forked, so no commit of it ever touched them, and
  the guard was the only thing that caught the proposed deletion.
- **A path main deleted since the fork is proposed as a resurrection** — the
  mirror case, with no guard at all before this ticket.
- **A path main CHANGED since the fork is silently reverted to its pre-fork
  content** — found 2026-09-07 evening on a QA note against BL-1408: the
  tip's own range touched 49 of a 114-path two-tree diff against
  origin/main; the other 65 were spurious (4 deletions and 1 resurrection,
  both refused by existing guards) and 60 reversions — 59 topic records
  under `backlog/topics/` plus `swarmforge/roles/specifier.prompt`. This
  form had already landed once: BL-1461's replay `04049f4bb2` (15:58:17)
  put `backlog/topics/BL-1465.json` back to its pre-fork content, erasing a
  message the daemon had appended four minutes earlier; the daemon's later
  write did not restore it and origin/main still lacks that message.

Fixed: `own-paths` now restricts the two-tree diff's delivered set to
`own-range-touched-paths` — the union of every commit's own changes over
`merge-base origin/main commit .. commit` (merges included, so a passenger
ride or an early sync merge, BL-1315's own case, still names the path) —
before any sibling-attribution decision runs. A path neither the parcel nor
a sibling ever touched now never reaches the replay at all: it is not
proposed as a deletion, not resurrected, and not reverted. The merge-deletion
guard (BL-1242) stays in place as the backstop for whatever this misses; no
change to attribution (BL-1472) or to `replay!`'s report (BL-1474).

Acceptance:
`specs/features/BL-1473-a-replay-never-deletes-or-resurrects-a-path-the-parcel-never-touched.feature`.

## `LAND_ESCALATE` carries the refusing guard's message, not a false "nothing to commit" (BL-1474)

`replay!` builds its tip-pure commit in the scratch worktree with `git
commit -q`, which runs the repository's own commit hooks — the same
commit-time guards (merge-deletion, ticket-deletion, registration, ...)
that run on every other commit in the repo. Before this ticket, ANY
non-zero exit from that commit — a guard's refusal included — was reported
as `"land-step replay: nothing to commit for <id> - own-paths identical to
origin/main"`, with the commit's own stderr never read. Twice on
2026-09-07 (`BL-1463-QA-followup-two-land-step-defects-20260907.md`, D2;
and again against BL-1408 that evening) a real, non-empty replay was
refused by a guard and `LAND_ESCALATE` reported it as an empty diff — QA
had to rebuild the commit by hand both times to learn what had actually
refused it (BL-1473, above, is that same evidence's other half).

Fixed: `replay!` now checks whether the scratch index was empty (`git diff
--cached --quiet`) **before** attempting the commit, and
`replay-commit-refusal-reason` uses that check, not the commit's exit
code, to decide the reason:

- Index empty → the original `"nothing to commit ... own-paths identical
  to origin/main"` message, unchanged.
- Index non-empty, commit refused, hook printed something → `"land-step
  replay: commit refused for <id> - <stderr>"`, quoting the refusing
  guard's own message verbatim (truncated past 2000 characters, with the
  truncation named).
- Index non-empty, commit refused, hook printed nothing → `"land-step
  replay: commit refused for <id>, no text"`.

A successful commit's flow, the passenger guards, and the completeness
check are unchanged — this only changes which of the three reasons an
already-failing commit reports.

Acceptance:
`specs/features/BL-1474-the-replay-reports-why-its-commit-was-refused.feature`.

## A revert or reapply commit is transparent to path attribution (BL-1472)

`path-owner-tickets` unions the ticket ids every commit in a path's
`git log origin-main..commit -- path` walk names, and `own-paths` (BL-1315)
keeps a path for the landing ticket when any of those touches names no
ticket — necessary so a lander's own conflict resolution or hotfix, which
names no ticket, is never excluded. A bounce revert (`Revert "Merge
documenter <sha> into QA."`) and its reapply (`Reapply "..."`, the subject
`git revert <revert>` writes) are untagged touches too, but on every path
the REVERTED commit carried — another ticket's paths, not the lander's own.

Live 2026-09-07: QA bounced BL-1348 (spec-gap) and reverted it (`108d9a46e7`),
then reapplied it (`adfc35e0c8`) on the specifier's adjudication. `own-paths`
for BL-1463 against that tip (QA evidence
`BL-1463-QA-followup-two-land-step-defects-20260907.md`, D1) kept 40 paths
including BL-1348's own bounced, mid-rework ruling-B production code and
tests — the revert and reapply both read as untagged touches on those
paths, so BL-1315's "an untagged touch keeps the path" rule kept them for
BL-1463 as if they were BL-1463's own. Against the pre-restoration tip the
same call correctly excluded only BL-1348's two bookkeeping files. A
BL-1463 land would have published BL-1348's unapproved code under BL-1463's
name with no warning.

Fixed: `path-owner-tickets` now recognises a revert or reapply commit by
subject (reusing `task_scope_gate_lib.bb`'s `revert-subject?`, BL-1295's
send-time predicate, widened to also match `Reapply "..."`, rather than a
second regex — BL-897's mirror rule) and skips it entirely rather than
counting it as a touch: the commit it undoes or redoes is still in the same
path-scoped walk and attributes the path on its own terms. A revert of the
LANDER's own tagged commit is still attributed by that commit, which is the
right answer — the content is the lander's, now absent. Every other
untagged commit still sets `:any-untagged?` exactly as before; BL-1315's
lander-own-untagged-edit rule and BL-1343's nobody-attributed-path-still-
replays rule are both unchanged. This is the land-time counterpart of
BL-1295, which already taught the send-time scope gate not to blame a
reverted ticket for its own revert's subject.

Acceptance:
`specs/features/BL-1472-revert-and-reapply-commits-are-transparent-to-path-attribution.feature`.

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
