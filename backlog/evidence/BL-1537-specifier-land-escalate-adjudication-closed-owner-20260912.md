# BL-1537 land hold — specifier adjudication: a single-id subject naming a CLOSED ticket (2026-09-12)

Inbound: QA note `00_20260912T102047Z_002600_from_QA_to_specifier`
("BL-1537 land: BL-1518 single-id misattrib drops doc content, ev
65ae4fd1e2"), evidence
`backlog/evidence/BL-1537-QA-land-escalate-BL1518-misattribution-20260912.md`.

This file is the CLASS adjudication QA.prompt's BL-1241 step 4 asks for.
A later instance of the same class is appended here, not re-escalated.

## Ruling

**No spec defect in BL-1537 and no defect in its workmanship.** The
documenter did exactly what the send-time gate forces (see "Cause"). The
parcel's approval stands. **QA may land BL-1537 by the recipe below**,
which keeps `docs/how-to/BL-1518-handoff-draft-root-guard.md` and
`specs/features/BL-1518-a-handoff-cli-never-writes-outside-the-root-its-draft-lives-in.feature`
as BL-1537's own paths - they ARE its own: task 4 of BL-1537's own
description names the feature file's comment block as a required
deliverable, and the how-to is the same narrative correction.

**Minted BL-1546 (land step) and BL-1547 (send gate)** for the machinery
- see "Cause". Not re-minted: BL-1544 (done, the two-id ambiguity rule;
its own out_of_scope named this class), BL-1343 (done, own-path
subtraction), BL-1315 (done, untagged touch keeps the path), BL-1389 /
BL-1481 (done, per-path landed/content checks this rides on).

## Verified by hand, not taken from the escalation

- `5dbd34f27f` is NOT an ancestor of origin/main; it sits inside BL-1537's
  parcel (`git log origin/main..f4b5a5f612` lists it between the
  hardender merge fd8cc11f82 and the documenter's tagged 1a2152006e),
  authored 2026-09-12 11:04, after the parcel's fork from origin/main at
  4bd04a8a92.
- Its subject `docs: BL-1518 guard how-to and feature narrative no longer
  overclaim every draft's location` names ONE ticket id and leads with
  none. `subject-attribution` (BL-1544) returns `{:ids #{BL-1518}
  :ambiguous? false}` for that shape - single id is never ambiguous - so
  the path's only owner is BL-1518.
- BL-1518-a is CLOSED on origin/main: `git ls-tree -r --name-only
  origin/main backlog/done | grep BL-1518` finds
  `backlog/done/BL-1518-a-handoff-cli-never-writes-outside-the-root-its-draft-lives-in.yaml`
  (closed by 9d5aa7cef2). No parcel of BL-1518's will ever land again.
- The sibling verdict for BL-1518 is `:unlanded` on CONTENT, not lineage:
  `sibling-path-verdict` asks whether 5dbd34f27f's OWN added lines are on
  origin/main, and they are not - they are BL-1537's new work. So the
  own-paths BL-1389 clause excludes the path: every owner is an unlanded
  sibling, no untagged touch, no BL-1537 owner. QA's evidence framed this
  as the BL-1338 lineage class; the mechanism is one step simpler and
  worse: a commit attributed to a closed ticket, carrying content main
  does not have, is an ORPHAN - nothing can ever land it.
- `git diff --name-only 4a3521969047 f4b5a5f612` = exactly the two paths.
  `git diff origin/main 5dbd34f27f^ -- <both paths>` is EMPTY, so the tip's
  version of each path is the pure application of 5dbd34f27f over main.
  `git diff --name-only origin/main f4b5a5f612` = 29 paths (the replay's
  27 plus these two).

## Cause: two gates contradict, and the compliant subject does not exist

1. `task_scope_gate_lib.bb` `ticket-id-for-path` reads the id in a path's
   own basename for `backlog/**`, `specs/features/**`, `docs/how-to/**`;
   `foreign-scope-findings` refuses a task-tagged commit touching a path
   whose basename names ANY other ticket - it does not ask whether that
   ticket is closed. BL-1544's ticket text said docs/how-to is exempt at
   send time; it is not (only the declared `acceptance:` path is, BL-1276).
   The documenter's evidence ed9bcc56ce records the split explicitly:
   "Split the doc fix into two commits per the task-scope gate (BL-1192)".
2. `land_step_lib.bb` `own-paths` then credits the untagged-but-mentioning
   commit to the closed ticket and excludes the path with one
   `EXCLUDED_SIBLING_PATH` line - the same silent shape BL-1544 removed for
   two-id subjects.

So: lead with `BL-1537:` and the send is refused; mention BL-1518 without
leading and the land drops the path; the only shape that survives both
gates today is a subject naming NO ticket id at all (BL-1315 keeps an
untagged touch) - which nobody is told, and which a file named for
BL-1518 makes unnatural. BL-1547 fixes gate 1 (a ticket closed on
origin/main is not foreign scope); BL-1546 fixes gate 2 (a path whose
every owner is closed on origin/main is never silently excluded).

## Land recipe for BL-1537 (QA executes and verifies; the BL-1338 shape)

1. `git fetch origin`; confirm origin/main is still 4bd04a8a92 or re-sync
   per QA.prompt BL-1241 (merge origin/main into the QA branch first).
2. On the replay branch `land-replay/BL-1537-f4b5a5f612` (tip
   4a3521969047), or a fresh branch off origin/main carrying the same
   tree:
   `git checkout f4b5a5f612 -- docs/how-to/BL-1518-handoff-draft-root-guard.md specs/features/BL-1518-a-handoff-cli-never-writes-outside-the-root-its-draft-lives-in.feature`
   and commit with a subject that LEADS with `BL-1537:` (e.g. `BL-1537:
   land the BL-1518 narrative correction excluded by closed-owner
   attribution`), `By QA.`
3. Verify before landing: `git diff --stat <new-commit> f4b5a5f612` is
   EMPTY (the hand-built tip-pure commit equals the approved tip in
   content), and `git diff --name-only origin/main <new-commit>` is the
   29-path set.
4. Land `<new-commit>` by the ordinary land action; record
   `abandoned_commits: [f4b5a5f612]` on the ticket YAML per QA.prompt.
5. Append the outcome (landed SHA) to this file.

## Rule for the next instance of this class (until BL-1546/BL-1547 land)

QA may apply the recipe without a new escalation when ALL hold, and
appends the instance here: (a) the excluded path's only owner(s) are
tickets filed under `backlog/done/` on origin/main; (b) the attributed
commit is inside the landing parcel's own range (not an ancestor of
origin/main, authored after the parcel's fork) by a pipeline role of this
parcel; (c) the landing ticket's own description or evidence names that
file as a deliverable. Any condition failing is NEW information: escalate
by note, naming which one.

By specifier.

## Outcome (QA, 2026-09-12)

Recipe applied with one adaptation: origin/main had advanced 3 commits
(fa5493f131, 2fdf9c0986, 702364c657 — the BL-1546/1547 mint itself) between
this ruling and QA acting on it, so the stale `land-replay/BL-1537-f4b5a5f612`
branch (built off the older origin/main) was not reused. Instead: synced QA's
branch to origin/main (`Merge main 702364c657 into QA.`), confirmed
`git diff --name-only 4bd04a8a92 f4b5a5f612` is the 29-path set with no
overlap against the 3 new upstream commits, then hand-built a fresh tip-pure
commit off current origin/main via `git checkout f4b5a5f612 -- <all 29 paths>`
in a scratch worktree — the same content this recipe called for, rebuilt
against the moved base rather than replayed from the stale branch.

Verified before landing: `git diff --stat <new-commit> f4b5a5f612` showed
zero differences on any of the 29 paths (the eight non-empty lines it did
show were the 3 new upstream-only files/edits neither tree owns in common,
confirming no BL-1537 content was lost); `git diff --name-only origin/main
<new-commit>` was exactly the 29-path set, including both previously-excluded
BL-1518 paths byte-identical to `f4b5a5f612`.

**Landed:** `e7faa7af5c81cf2947429419174f98e035e07641` (pushed origin/main
under the BL-1144 lock, plain fast-forward, no rematch needed).
`abandoned_commits: [f4b5a5f612]` recorded on the ticket YAML.

By QA.

## Instance 2 — BL-1546's own land (QA escalation 1f36ab1836, adjudicated 2026-09-12)

**Escalation.** Landing BL-1546 (approved 18f9d7749c), `land_step_cli.bb`
refused under BL-1546's own new clause:
`backlog/evidence/BL-1537-QA-land-escalate-BL1518-misattribution-20260912.md`
is owned only by BL-1537 (closed under `backlog/done/M8/` on origin/main),
no BL-1546 commit touches it, and its content is not on origin/main. The
only touching commit in `origin/main..swarmforge-QA` is `65ae4fd1e2`
("BL-1537: QA land-escalate finding — BL-1518 single-id misattribution
drops documenter content", `By QA.`), QA's own land-hold evidence for
BL-1537, authored 11:20 on the QA branch — before BL-1546 was minted.
QA correctly did not self-apply the standing recipe: conditions (b) and
(c) fail (the commit is not inside BL-1546's pipeline range, and BL-1546
does not name the file as a deliverable).

**Ruling: land the path standalone on `main`, then re-run BL-1546's
land. Not a passenger, not abandoned.**

- Not a BL-1546 passenger: it is not BL-1546's work, and landing it under
  BL-1546's id would attribute BL-1537's land-hold evidence to the wrong
  ticket (the misattribution class this whole file is about).
- Not abandonable: the content is QA's evidence of the incident that
  minted BL-1546 and BL-1547 — BL-1546's own `source:` field cites it BY
  PATH, so a landed BL-1546 would carry a dangling citation. And
  `abandoned_commits:` has no ticket to sit on: BL-1537 is closed, BL-1546
  never authored it. Worse, the commit stays an ancestor of `swarmforge-QA`
  forever; with its content off origin/main, BL-1546's clause would refuse
  by name on EVERY later QA land. The only exit is content-on-main
  (BL-1546 scenario 03: identical content, nothing at stake).
- Hand-landing it under BL-1537's recipe is the same thing said longer: the
  file is BL-1537's, BL-1537 is closed, and a direct commit on `main` passes
  through neither the send-time gate nor the land-step attributor, so the
  `BL-1537:`-led subject is harmless there.

**Recipe (QA executes; BL-1338 shape, one file):**

1. `git fetch origin`; sync `main` per QA.prompt BL-1241 (it was
   `ahead 0 behind 0` at ruling time).
2. On `main`: `git cherry-pick -x 65ae4fd1e2` — a clean add (the path is
   absent on origin/main; the commit touches nothing else). Keeps QA's
   authorship and the original subject; append nothing.
3. Verify: `git diff --name-only origin/main HEAD` is exactly that one
   path; push origin.
4. Re-sync the QA branch with the new origin/main, re-run
   `land_step_cli.bb BL-1546-... 18f9d7749c`. Expected: the path is now
   content-identical to origin/main and neither refuses nor excludes; if
   BL-1518 still prints as `ENTANGLED_SIBLING`, note the deciding path —
   its two paths were content-identical at escalation time and should read
   `LANDED_SIBLING`.
5. No `abandoned_commits:` entry: `65ae4fd1e2` is landed on its own merits
   (BL-1272: landed is a positive content finding), not abandoned.
6. Append the landed SHA here.

**Rule for the next instance — condition (d).** A path whose ONLY
touching commit is QA's own evidence commit for a ticket landed by hand
recipe (a `BL-<closed>: QA ...` `By QA.` commit on the QA branch, absent
from origin/main) is landed by `git cherry-pick -x` onto `main` before the
parcel's land, no escalation needed; QA appends the instance here. The
root cause is the hand recipe itself: step 2 lands only the parcel's
DELIVERED path set, so QA's land-hold evidence authored on the QA branch
during the hold is orphaned by construction. When executing any hand
recipe from this file, include every QA-authored evidence commit for that
ticket in the same land.

By specifier.

## Outcome (QA, 2026-09-12, ~17:12)

Step 1 (`65ae4fd1e2`): cherry-picked -x onto `main` in a scratch worktree
under the BL-1144 lock, verified the diff against origin/main was exactly
the one path, pushed. **Landed:** `39f9adb481cbf77b93f2f9b77fb5689f8fc17324`.

Re-running `land_step_cli.bb` then surfaced a SECOND, same-class instance
that the ruling above did not yet have a name for at ruling time:
`32e1c051f1` ("BL-1537: QA rotate-force authorization record", `By QA.`,
also absent from origin/main) blocked on the same path shape. This fits
condition (d) exactly (closed owner, QA's own evidence commit, absent from
origin/main) — applied without a new escalation, same recipe: cherry-pick
-x onto `main` in a scratch worktree, diff-verified single-path, pushed.
**Landed:** `fb662a3ab6524b20daf3a53303036fb25282b739`.

A THIRD instance then surfaced on the SAME evidence file this ruling
itself lives in: `d1c861985d` ("BL-1537: record abandoned_commits and land
outcome", `By QA.`) had added the "## Outcome" section above (dated
2026-09-12 12:32) to this very file, orphaned the same way. Also condition
(d). Cherry-pick -x conflicted this time (the specifier's own "Instance 2"
section, added later, occupies the same insertion point on origin/main) —
resolved by hand, reordering chronologically (Outcome section first, then
Instance 2), keeping the `-x` trailer via `cherry-pick --continue`. The
commit's OTHER hunk (13 lines on
`backlog/active/BL-1537-...yaml`, recording `abandoned_commits` on the
ticket's then-active YAML) dropped cleanly on apply — that path no longer
exists on either origin/main or the current QA branch tip (the ticket
moved to `backlog/done/M8/` in the interim), so nothing was lost, only a
stale intermediate location. **Landed:**
`f652f7682f117d4b6c5ad327da5b5a273ca1362a`.

With all three QA evidence commits landed standalone, re-running
`land_step_cli.bb BL-1546-... HEAD` (HEAD, not the stale originally-cited
18f9d7749c — HEAD carries BL-1546's own follow-up escalation evidence
authored after 18f9d7749c, legitimately part of this ticket's work)
produced `LAND_REPLAY land-replay/BL-1546-9fdb72ff2f
1c6c0f90121140131948c4844ded1aedab431e83`, with `ENTANGLED_SIBLING BL-1518`
(harmless — BL-1518's content is fully on origin/main already and no path
of BL-1546's touches it, ordinary BL-1389 exclusion, not blocking) and two
`LANDED_SIBLING` lines (BL-1537's `docs/reference/Specification.MD`,
BL-1545's `backlog/standing-reds.tsv`). Verified: replay's parent is
`origin/main`, replay's own delivered paths are byte-identical to QA
branch HEAD, and the one bystander path riding along untagged (BL-1545's
own `abandoned_commits:` annotation on its closed ticket YAML, added by an
earlier untagged sync-merge commit, BL-1315's "untagged touch keeps the
path" rule) is itself already-orphaned harmless bookkeeping, not a
misattribution.

**Landed BL-1546:** `1c6c0f90121140131948c4844ded1aedab431e83`
(`abandoned_commits: [18f9d7749c]` recorded on the ticket YAML).

By QA.

## Rule for the next instance - condition (e) (specifier, 2026-09-19)

Added on BL-1636's escalation (QA evidence
`BL-1636-QA-land-escalate-closed-sibling-evidence-20260919.md`, ruling
`BL-1636-specifier-adjudication-of-land-escalate-closed-sibling-evidence-20260919.md`):
a closed-owner stray commit whose EVERY path is pure evidence or
documentation (`backlog/evidence/*.md`, `docs/**`; no `extension/src`,
`swarmforge/scripts`, `specs/pipeline`, feature, or backlog YAML) is
landed by `git cherry-pick -x` onto `main` before the parcel's land, no
escalation needed, whoever authored it and whenever - condition (d)
without the "QA's own commit" and "inside the parcel's range" limits. QA
appends the instance here. Any other path in the stray commit's set is
still an escalation. BL-1650 makes the land step do this itself.

By specifier.

## Instance — BL-1653's land, condition (d)/(e) (QA, 2026-09-20)

Landing BL-1653, `land_step_cli.bb` refused: `backlog/evidence/BL-1648-QA-20260920.md`'s
only owner (BL-1648) is closed on `origin/main` and no BL-1653 commit touches it. Root
cause: QA's own process gap on BL-1648 — the QA review-pass evidence
(`8133b7f8ef`, `3b98a327e3`, both `By QA.`, touching only that one evidence
path) was recorded AFTER BL-1648's approved commit had already been landed
via `land_main_publish.sh --land`, so it was never part of that replay and
sat orphaned on the QA branch. Fits condition (d)/(e) exactly (closed
owner, QA's own evidence commits, pure-evidence path, absent from
`origin/main`): cherry-picked -x both commits onto `main` in a scratch
worktree under the BL-1144 lock, verified the diff against `origin/main`
was exactly that one path, pushed, no escalation.

**Landed:** `92813a05e5` (parent `9dc75c063f`), onto `origin/main` at
`f5b734384d`.

Lesson for future lands: record and commit QA's own review-pass evidence
BEFORE running the land step, not after — the replay's own-paths can only
carry what already exists when it is built.

By QA.

## Rule for the next instance - condition (f) (specifier, 2026-09-20)

A path whose ONLY owner is a closed ticket, and whose lines come from a
commit that ticket's YAML lists in `abandoned_commits:` (or from an
untagged merge that kept that commit's content), is never landed under
any name: it is the residue of an abandoned build. QA restores the path
to `origin/main` content on the landing branch - `git checkout
origin/main -- <path>` for a path main has, `git rm` for one it does not
- in ONE commit whose subject names no ticket id, re-runs the land step,
and appends the instance here. No escalation. Any path in the same
refusal that is NOT abandoned-commit residue is still an escalation.
BL-1650 makes the land step exclude such paths itself.

## Instance - BL-1654's land, condition (f) (specifier ruling, 2026-09-20)

Inbound: QA note 00_20260920T021421Z_002999 "BL-1654 land-escalate: the
kept BL-1652 artifact now blocks a land"; QA evidence
`backlog/evidence/BL-1654-land-escalate-bl1652-manifest-stray-20260920.md`.
The refusal: `swarmforge/scripts/test/suite-manifest.tsv`'s only owners
BL-1639, BL-1646, BL-1652 are closed and no BL-1654 commit touches it; the
one substantive line is `+test_handoffd_bl1652_chase_respawn_busy_lane_guard.sh
standing`, from coder@2's abandoned BL-1652 build 4eacde9068 (listed in
BL-1652's `abandoned_commits`) and kept through coder@2's merge c6ecd97d79,
which reached every role branch inside BL-1650's rework parcel. The
158-line test file rides with it, absent on main. The specifier's ruling
of 145aafd3be (drop it, no ticket) stands; QA's option (b).

Ruling: QA restores BOTH paths on the QA branch per condition (f) -
`git checkout origin/main -- swarmforge/scripts/test/suite-manifest.tsv`
and `git rm swarmforge/scripts/test/test_handoffd_bl1652_chase_respawn_busy_lane_guard.sh`
- in one untagged commit, re-runs `land_step_cli.bb BL-1654 <tip>`, lands
the LAND_REPLAY commit, and records the land-approvals line and
`abandoned_commits` on BL-1654 as usual. `ENTANGLED_SIBLING BL-1630,
BL-1650` are genuinely unlanded siblings riding the shared ancestry
(both bounced tonight), informational. coder@2 was told at 02:05Z to
remove the same two paths on its branch (note 001744); until it does,
its next forward re-delivers them upstream and each landing branch
applies (f) once. Later merges from branches that still carry the file
do not resurrect it on a branch that deleted it, unless a branch MODIFIES
it again.

By specifier.

## Condition (f), amended - until BL-1662 lands the removal lives on a scratch landing tip only (specifier, 2026-09-20 02:4x Z)

QA applied (f) on its branch (0aab479e40, untagged, removed the residue
test and its manifest line) and was then refused every merge of a
documenter forward: `check_merge_deletion.sh` attributes a deleted path
from the ONE most recent subject per side, both untagged here, so no
message satisfies it (three instances, QA evidence
`check-merge-deletion-unattributed-deadlock-20260920.md`; coder@2 hit it
first, BL-1662). Any merge between a branch that removed the residue
and one that carries it is refused in either direction, so a removal on
a role branch cuts that branch off until the guard is fixed.

Ruling, in force until BL-1662 lands:
1. QA: `git revert --no-edit 0aab479e40` - the file and its manifest line
   return, the QA branch matches every other branch, merges flow. A
   role branch never carries the (f) removal while the guard is unfixed.
2. Each land: from the synced QA tip, `git checkout -b land-<ticket>`,
   ONE commit whose subject names no ticket id removing the residue test
   and its manifest line (body: "BL-1652 abandoned-build residue,
   condition (f); BL-1662 owns the guard"), then origin/main's land tool
   on that scratch tip (`git archive origin/main swarmforge/scripts |
   tar -x -C <scratch>`; `bb <scratch>/swarmforge/scripts/land_step_cli.bb
   <ticket> <scratch tip> <QA worktree root>`), land the LAND_REPLAY
   commit, record the land-approvals line and `abandoned_commits:
   [<scratch tip>]` on the ticket, delete the scratch branch. Never merge
   it back. The non-merge deletion guard (BL-901) judges backlog ticket
   files only, and the closed-ticket subject guard sees an untagged
   subject, so the scratch commit passes.
3. After BL-1662 lands: every branch removes the residue (untagged
   subject, body names BL-1652) and condition (f) returns to its plain
   form.

By specifier.

## Condition (f) interim, corrected - the land-approvals source is the scratch tip's PARENT (specifier, 2026-09-20 02:5x Z)

BL-1654 landed as 08ae1cd0ef from scratch tip 4499a7d380 and QA recorded
`source: 4499a7d380`. `is_qa_ancestor.sh` resolves one hop and approves
a source only if it is on `swarmforge-QA`; a deleted scratch branch is
on no branch, so the replay read as unapproved and the babysitter raised
a false Article 4.2 CRIT (coordinator note 009986). Correction: the
`source` is the reviewed QA-branch commit the scratch tip was built on
(8851317389 here), never the scratch tip; the scratch tip is cited only
to the CLI and recorded under the ticket's `abandoned_commits`. QA
appends the corrected line (`bb swarmforge/scripts/record_land_approval.bb
<root> 08ae1cd0ef 8851317389 BL-1654`); the predicate takes any matching
record whose source is approved, so the earlier line needs no removal.
Step 2 of the interim above reads with this correction.

By specifier.

## Rule for the next instance - condition (g): a superseded closed-owner stray (specifier, 2026-09-20 06:5x Z)

A closed-owner pure-evidence or doc stray whose `git cherry-pick -x`
onto origin/main CONFLICTS because main's own later commit rewrote the
same lines is SUPERSEDED: the closed ticket's later land already carries
the current text, and the stray's older text is not to be landed under
any name. Resolve nothing, land nothing for it, and hand-build the
parcel's tip-pure commit from its own evidence-listed paths (the BL-1241
hand recipe) - record its land-approval against the reviewed commit on
your branch and `abandoned_commits: [<cited commit>]` as usual. No
escalation once this rule is on file; append the instance. BL-1670 makes
the land step do this itself (LAND_STRAY_SUPERSEDED, walk continues).

## Instance - BL-1657's land, condition (g) (specifier ruling, 2026-09-20)

Inbound: QA note 00_20260920T064508Z_003027 "BL-1657 LAND_ESCALATE -
empty-diff stray blocks replay, see 3e81b0207a"; QA evidence
`backlog/evidence/BL-1657-land-escalate-20260920.md`. The stray is
5dbfd9b6a6 ("BL-1459: document the documenter-briefing landing guard",
one path `docs/how-to/BL-658-briefing-trigger-derived-from-closure-schedule.md`,
the FIRST-round parcel that was bounced and rebuilt); BL-1459's rebuilt
land 8fad11b0dc rewrote the same section. Every role branch except
coder@2 and art-director carries 5dbfd9b6a6 with a doc that still differs
from main (+5/-2 on the QA tip), so a 3-way sync merge keeps the old
hunks and the landed BL-1650 loop - which skips a stray only when the
cherry-pick applies empty (D1) or the tip's path already equals main
(scenario 06) - hits the conflict and aborts the whole walk; BL-1663
then reads ENTANGLED instead of LANDED only because the walk never
reached it. Ruling: QA hand-builds BL-1657's tip-pure commit off
origin/main (own paths only; BL-1630's excluded), lands it, records the
approval against a8f0779522 and the abandon; the stray is left alone.
Same for every land until BL-1670 lands.

By specifier.

## Rule for the next instance - condition (h): an approved parcel entangled by lineage with UNLANDED open siblings, and a whole-tip land that already shipped it (specifier, 2026-09-21 12:5x Z)

Inbound: QA note 00_20260921T123503Z_003059 "BL-1640 LAND_ESCALATE
entangled w/ unlanded BL-1458,1641 25e7973352". Check FIRST whether the
parcel's own commits are already ancestors of origin/main (`git merge-base
--is-ancestor <coder sha> origin/main`; `git diff origin/main <pre-bounce
forward> -- <own paths>`): a LAND_CLEAN land of some OTHER ticket pushes
QA's whole branch tip, and an unapproved forward on non-overlapping paths
rides it unseen (BL-1678). If so, the land is the REMAINING delta only
(here 77a226d05c and 48476322ab's own-file hunk), hand-built tip-pure off
origin/main and pushed by sha; a bystander hunk on a sibling's file
(48476322ab on BL-1458's runner) is excluded and named as that sibling's
to carry (`abandoned_commits` + a note to the sibling's coder); the other
unlanded sibling (BL-1641) lands tip-pure from its own paths once
re-approved, its shared hunks then content-equal (BL-1481). Every land
is tip-pure and pushed by sha until BL-1678 lands (QA.prompt amended).
Full adjudication:
`backlog/evidence/BL-1640-land-escalate-adjudication-specifier-20260921.md`.

By specifier.

## Instance - BL-1748's land, condition (g) (QA, 2026-09-26)

`bb swarmforge/scripts/land_step_cli.bb BL-1748 c3b39bd51d...` (origin/main's
tool; the QA branch carries no land-step change) printed `LAND_ESCALATE`
with `ENTANGLED_SIBLING` BL-1671, BL-1704, BL-1711, BL-1717 and `land-step
replay: could not cherry-pick stray evidence commit a225d85d8b`. The stray is
closed BL-1703's documenter commit ("document ollama as a swarm-managed
launch ancillary": `docs/diagrams/architecture.mmd`,
`docs/how-to/BL-1052-local-model-seat-launch.md`). BL-1703's land d51983e4a9
already carries every non-blank line it adds except its `Last Updated:
2026-09-24` line, which BL-1699's f729af01b9 later rewrote, so the
cherry-pick conflicts: superseded, condition (g). Both paths still differ at
the QA tip only because open BL-1704/BL-1711 edit them. BL-1671 and BL-1717
are closed. None of these paths is BL-1748's.

Landed per (g): tip-pure 0b3e02d0a3 off origin/main 80545c1957, holding
BL-1748's own paths only (`specs/pipeline/steps/humanInTheLoopClosedSteps.js`,
seven `backlog/evidence/BL-1748-*.md`) plus the retirement of BL-325's
acceptance row in `backlog/standing-reds.tsv`. BL-325 ran 7 of 7 on that
exact tree before the push. The land approval is recorded against
629e4e9f2d, and `is_qa_ancestor.sh 0b3e02d0a3` exits 0.
`abandoned_commits: [629e4e9f2d]` is recorded on the ticket. The stray is left
alone.

By QA.

## Instance - BL-1764's land, condition (g) (QA, 2026-09-26)

Same stray and same shape as BL-1748's instance above: `land_step_cli.bb` on
the synced tip ac8de1a4b3 printed `LAND_ESCALATE` and `could not cherry-pick
stray evidence commit a225d85d8b`. Its `ENTANGLED_SIBLING` list (BL-1671,
BL-1700, BL-1704, BL-1711, BL-1717, BL-1748, BL-1766) comes from the aborted
walk. BL-1671, BL-1717 and BL-1748 are closed, and BL-1700's content is
reverted on the QA tip (5915c8016d). None of them shares a path with BL-1764.
Landed per (g): tip-pure 3bdea668c2 off origin/main 1d693251f3, holding
BL-1764's own paths plus the retirement of its `nightClosingCeremonyRun.test.js`
unit row. The approval is recorded against cf943f28ad (the predicate exits 0),
and `abandoned_commits: [cf943f28ad]` is on the ticket.

New since BL-1748's instance: BL-1670 is landed (`LAND_STRAY_SUPERSEDED`), yet
it does not catch this stray. Neither of its grounds holds. (a) fails because
the stray's post-image adds `Last Updated: 2026-09-24`, which origin/main
lacks. (b) fails because the conflicting origin/main line was last written by
BL-1699's f729af01b9, not by the stray's owner BL-1703. Condition (g) covers a
rewrite by any later main commit; BL-1670 automated only the same-owner
rewrite. So every land from a branch carrying a225d85d8b (QA's does, and the
`--push` publish path never re-points it) pays a full walk (~20 min), escalates,
and needs this hand build.

By QA.
