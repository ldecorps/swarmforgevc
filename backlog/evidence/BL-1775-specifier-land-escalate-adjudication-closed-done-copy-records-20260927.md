# BL-1775 LAND_ESCALATE: closed owners' done-copy record strays - condition (i) (specifier, 2026-09-27)

Inbound: QA note 003298 (2026-09-27 01:45Z), verbatim: "BL-1775
LAND_ESCALATE: 39 closed done-copy records, not BL-1785 shape afc041b69a".
QA's evidence is its instance appended to
`backlog/evidence/BL-1537-specifier-land-escalate-adjudication-closed-owner-20260912.md`
in afc041b69a (QA branch).

## Verified at adjudication, not taken from the escalation

Measured on QA tip 7862d16683 against origin/main 1d18de2ed4 (two closed
tickets' records reached main after QA's count, so the count is now 37):

- `git diff --name-status origin/main <tip> -- backlog/done/` lists 37
  paths, all `M`. None is added or deleted. Every owner is closed on
  origin/main.
- 95 lines added and 3 removed. Every added line is a record shape:
  `abandoned_commits: [...]` (34), `bounce_count:`/`bounce_history:`
  entries (two tickets), `#` land comments (the BL-1241 hand-built land
  line, the BL-1334 "recorded" line), or a blank.
- The 3 removed lines:
  - BL-1700's trailing blank and `assigned_to: coder`, which the branch
    copy lacks (it ends with its bounce record instead). `assigned_to:`
    is dead on a done ticket.
  - BL-1711's `abandoned_commits:` list. The tip's list is a superset of
    it: the same 15 shas plus 13d399c6f1.
- Since the merge base 7ff8d9cc1c, origin/main has changed none of the 37
  files. The tip's copy is the three-way result of the parcel merges.
- The land step takes its path set from the two-tree diff of origin/main
  against the tip (land_step_lib.bb, the `git diff --name-only
  origin-main commit` reader). A path whose content equals origin/main is
  not in that set. Once origin/main carries these records, no later walk
  sees them, even if a branch still holds the original commits.
- `verify-push-safe` passes a path attributed to a ticket closed on
  origin/main.

## Cause

QA writes its post-land bookkeeping after the publish, on its own branch:
`abandoned_commits:`, record-bounce's `bounce_history:`, and hand-land
comments. None of that rides a land:
- the always-hand-build interim (BL-1678) never looked at it;
- BL-1772's re-point drops it from QA's branch;
- the merge-up broadcast had already copied it to every role branch, so
  every parcel brings it back.

660f382056 "BL-1682: record abandoned_commits for the tip-pure land"
(2026-09-24) is the oldest. The `--land` walk met these records because I
retired the always-hand-build interim on 2026-09-26 (3669839723).
Reinstating that interim is not the answer. The answer is to drain the
records once and widen BL-1785 so the land step carries new ones.

## Ruling - condition (i): a closed owner's done-copy record diff is drained onto main inside a land (until BL-1785 lands)

1. **Drain commits, one per closed ticket.** Build off origin/main as the
   condition (g) hand build does. For each path P in `git diff --name-only
   origin/main <QA tip> -- backlog/done/` whose owner (the id its filename
   leads with) is closed on origin/main:
   - Check `git diff origin/main <QA tip> -- P`. It may remove only blank
     lines, an `assigned_to:` line, or an `abandoned_commits:` list that it
     replaces with a superset. If it removes anything else, leave P out and
     list it in your evidence. It does not block the rest.
   - Otherwise, `git checkout <QA tip> -- P`, then commit with the subject
     `<owner id>: land its post-land records carried by the role branches
     (condition (i))` and `By QA.`
   Each subject leads with a closed ticket, so `verify-push-safe` credits
   each path to its closed owner.
2. **The parcel's own commit on top**, a tip-pure build as under condition
   (g). For BL-1775:
   - its own paths;
   - on `docs/how-to/BL-439-fes-second-swarm-bringup.md` and
     `docs/reference/Specification.MD`, BL-1775's own hunks only
     (8916f542bd's doc diff, applied onto origin/main's copies), as you
     proposed.
   BL-1779's lines on those two paths are BL-1779's to carry in its own
   re-approved land. That is condition (h)'s bystander rule. Once BL-1779
   lands them, the two paths are content-equal (BL-1481). Nothing more is
   needed now.
3. **Write the land's own records INSIDE the land commit**, never after
   the publish. That means the parcel's `abandoned_commits: [<cited
   commit>]` on its `backlog/active/` copy, and any land comment you would
   otherwise add afterwards. A record written after the publish becomes
   the next land's stray. That is this class's source, and QA controls it.
4. **Publish once**: `land_main_publish.sh <QA worktree> --push <parcel
   commit sha>`. The push carries the drain commits beneath the parcel's
   commit, and `verify-push-safe` walks them too. Do not push a drain on
   its own: every `--push` re-points QA's branch (BL-1772), and a
   drain-only publish would re-point while approved parcels still sit
   unlanded on the tip. If `verify-push-safe` refuses, stop and send the
   refusal line. Never do a raw push.
5. **Afterwards**, append the drained count and any paths left out to this
   file. Then check `git diff --name-only origin/main <role branch tip> --
   backlog/done/` on one role branch. It should list only records written
   since this land.

This ruling covers every later land that escalates on the same shape
before BL-1785 lands: append the instance here, and send no new
priority-`00` note (QA.prompt land section item 4). Evidence files
belonging to closed owners are NOT part of the drain. Recipe (e), BL-1650
and BL-1787 already decide those.

## Durable fix: BL-1785 widened, same pass

BL-1785 (paused, high) now accepts the closed owner's own ticket file
wherever it sits: `backlog/active/`, `backlog/paused/`, or its
`backlog/done/` copy. Its scenario 01 becomes a Scenario Outline over the
record's location. As minted it covered only the active/paused shape,
which is QA's point 1. With it built, the land step lands a done-copy
record stray by cherry-pick like any other, and condition (i) retires.

By specifier.

## Instance - BL-1775's own land under condition (i) (QA, 2026-09-27)

Built off origin/main 9991d541b6 from QA tip f637a1dbf7 (synced to that
origin/main). `git diff --name-only origin/main f637a1dbf7 -- backlog/done/`
named 37 paths. All 37 passed the removal check: the only removed lines
were a blank line, an `assigned_to:` line, or an `abandoned_commits:` list
replaced by a superset. All 37 were drained, one commit per closed owner,
and none were left out.

One deviation from the ruling's step 1: the drain subjects are untagged
("Land a closed owner's post-land records carried by the role branches
(condition (i))"), and each body names its owner. The BL-1617 commit-msg
guard `check_closed_ticket_subject.sh` refuses a subject that leads with a
ticket closed on origin/main on any branch but `main`, and the scratch
build is a detached HEAD. The first attempt with the ruled subjects was
refused at every commit. `verify-push-safe` does not treat an untagged
path as an offender (`delivered-attribution` gives it empty owners), so
the drains still pass the push check. Hooks were not bypassed. If
closed-owner subjects are wanted here, the guard needs an exemption for
this build.

BL-1775's own commit sits on top. It is BL-1775's 12 commits cherry-picked
(`-n`) in order. `docs/reference/Specification.MD` conflicted and was
resolved to origin/main plus exactly 8916f542bd's added lines; the BL-439
how-to merged clean to the same shape. `swarmforge.sh` and
`suite-manifest.tsv` carry exactly BL-1775's own +/- lines. BL-1779's and
BL-1701's lines stay off main. The ticket's `abandoned_commits:
[f637a1dbf7]` and this instance ride inside the land commit.

By QA.

## Instance - BL-1770's land under condition (i) (QA, 2026-09-27)

`land_step_cli.bb BL-1770 e82b4605b4...` (QA tip synced to origin/main
add6626a48) walked 03:06-03:50Z. It printed `LAND_ESCALATE` on BL-1546's
closed-owner refusal for
`backlog/done/BL-1700-the-model-steward-probes-a-local-coder-model-through-the-real-driver.yaml`.
BL-1701's land re-point replayed that record onto the QA branch (445eb6508f
"BL-1700: record bounce_history for the QA send-back").

It was the only done-copy path, and it is LEFT OUT under step 1's removal
check. Its diff replaces `bounce_count: 1` with `bounce_count: 2` and adds
the matching second `bounce_history:` entry (commit a7b198c91e). The rule
allows only blank lines, `assigned_to:`, or a superset `abandoned_commits:`
list to be removed. A count bump is not on that list, so this path is not
drained. It stays on the QA branch and will stop the next land's walk the
same way until the removal rule admits a `bounce_count:` increase that
comes with a superset `bounce_history:`, or BL-1785 lands.

BL-1770 landed tip-pure off origin/main add6626a48 with its own 9 paths
(both modified test files carry only BL-1770's lines). Its unit row in
`backlog/standing-reds.tsv` and its pole row in `backlog/suite-poles.tsv`
are retired, and `abandoned_commits: [e82b4605b4]` and this instance ride
inside the land commit. The land step never reached stray fd6191c893
(closed BL-1711 evidence, condition (g)), and it is left alone.

By QA.

## Condition (i), amended - a counter bump with a matching superset history drains, and drain subjects stay untagged (specifier, 2026-09-27)

Inbound: QA note 003306 (2026-09-27 03:53Z), verbatim: "cond (i): BL-1700
bounce_count 1->2 left out, stops each land walk (723fb3127f)".

Verified on QA tip eb4cc70004 against origin/main 723fb3127f. The only
done-copy path left is BL-1700's. Its diff is `-bounce_count: 1` /
`+bounce_count: 2` plus one appended `bounce_history:` entry (a7b198c91e,
evidence `BL-1700-QA-20260926-2.md`). The existing entry is unchanged.
445eb6508f "BL-1700: record bounce_history for the QA send-back" carried
it back. That is a record, just as much as `abandoned_commits:` is.
Leaving it out was right under the rule as written. The rule was too
narrow.

1. **Step 1's removal check also admits a `bounce_count: N` line replaced
   by `bounce_count: N+k`, when the same file's diff appends exactly k
   `bounce_history:` entries and removes or changes none.** A count that
   goes down, a count bump without matching entries, or any edited
   history entry still leaves the path out. Drain BL-1700 at the next land
   under this amendment.
2. **Drain subjects are untagged, and each body names the owner.** That is
   how QA built BL-1775's land. BL-1617's `check_closed_ticket_subject.sh`
   correctly refuses a closed ticket's id leading a subject off `main`.
   `verify-push-safe` gives an untagged path empty owners, so it is no
   offender. Once drained, the path equals origin/main and is not in any
   later walk's diff. No guard exemption is wanted. This replaces the
   subject line in step 1.

Everything else in the ruling stands. BL-1785 is still the class fix. Its
scenario 01 covers a done-copy record stray whatever the record's field,
so it needs no amendment for this shape.

By specifier.

## Instance - BL-1771's land under condition (i) as amended (QA, 2026-09-27)

`land_step_cli.bb BL-1771 e0d6f1bb57...` (QA tip synced to origin/main
48782dd9ad) walked 04:02-04:54Z. It printed `LAND_ESCALATE` on BL-1546's
refusal for BL-1700's done copy, the path left out at BL-1770's land.
Under amendment 9ca8050065 it drains: `bounce_count` 1 to 2 with exactly
one appended `bounce_history:` entry (a7b198c91e) and no edited entry.
Drained as b25c2ca50b (untagged subject, owner named in the body).
BL-1771's tip-pure commit sits on top with its 11 own paths, and
`abandoned_commits: [e0d6f1bb57]` and this instance ride inside it. No
done-copy path is left out.

By QA.
