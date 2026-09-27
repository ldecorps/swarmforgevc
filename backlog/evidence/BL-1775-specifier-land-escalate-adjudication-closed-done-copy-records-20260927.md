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
