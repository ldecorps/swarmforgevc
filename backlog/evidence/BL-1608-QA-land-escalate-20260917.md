# BL-1608 land escalation — 2026-09-17

BL-1608 itself is fully verified and QA-approved (full unit suite green
625/625, property suite green 412/412, all five acceptance features
green — BL-1608, BL-1185, BL-1001, BL-1004, BL-1167 — `required_wiring`
OK, ancestry to the coder/cleaner/architect/hardener/documenter chain
confirmed). The earlier BL-1608 bounce to hardender (task
`BL-1608 [behavior: standing-red row for BL-1185 reinstated by hardener
merge]`, commit `70c01cd3e3`) was retracted — the row's presence pending
QA's own land action matches the same-batch, same-file precedent already
adjudicated on BL-1607 (`backlog/evidence/BL-1576-merge-drop-guard-false-positive-documenter-20260916.md`:
"BL-1607's row is correctly present... that ticket's fix only landed
today"), not a hardener defect. Correction recorded via
`record-bounce-correction.js` (BL-1608, commit `bb1a4ad57d`).

QA's current branch tip (`4e4e60a6a5`) also carries this same
documenter-batch's other tickets, at various dispositions:

- BL-1605: bounced to coder (`socketFixtureShortRootGuard` violation in
  its new step handler), unresolved.
- BL-1607, BL-1599: still queued for QA review, not yet dispositioned.

`bb swarmforge/scripts/land_step_cli.bb BL-1608 4e4e60a6a5` (the BL-1241
remedy) cannot build a tip-pure replay:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1185
ENTANGLED_SIBLING BL-1576
ENTANGLED_SIBLING BL-1599
ENTANGLED_SIBLING BL-1605
ENTANGLED_SIBLING BL-1607
BL-1608: entangled tip - sibling ticket(s) BL-1185,BL-1576,BL-1599,BL-1605,BL-1607
unlanded as ancestors, tip-pure replay could not complete cleanly; specifier
adjudication needed.
land-step: refusing to replay BL-1608 - backlog/evidence/BL-1576-merge-drop-guard-false-positive-documenter-20260916.md's
only owner(s) BL-1576 are closed on origin/main (backlog/done/) and no commit
of BL-1608's own touches backlog/evidence/BL-1576-merge-drop-guard-false-positive-documenter-20260916.md
- never decided silently (BL-1546)
```

The blocker: `backlog/evidence/BL-1576-merge-drop-guard-false-positive-documenter-20260916.md`
is a SHARED evidence file the documenter wrote in one pass covering
BL-1599 and BL-1607 jointly (not BL-1608), but the land step's
attribution walk cannot cleanly resolve its ownership against BL-1608's
own commit set, and refuses per BL-1546 rather than guess.

Per BL-1241 item 3/4: this is not a bounce to any author (nothing here is
a code defect) — landing BL-1608 alone right now would require excluding
BL-1605's still-unresolved step-handler file from the tip, which the
automated replay cannot do cleanly given the shared evidence-file
attribution ambiguity.

Proposed resolution (direction, not mandate): since BL-1605's own bounce
is independent of BL-1608's content, and BL-1599/BL-1607 are still being
reviewed in the same QA pass, holding BL-1608's land until the sibling
set resolves (either all land together with every satisfied ticket named
per Article 2.6, or BL-1605 is excluded once its coder fix returns) is
likely the least-disruptive path. Continuing to process BL-1607 now;
BL-1608 waits for this adjudication before landing.

## Same structural blocker recurs on BL-1607 (same pass)

BL-1607 also fully verified (unit suite green apart from BL-1605's
already-bounced, unrelated defect; the guard test green 20/20 isolated
and in 3 full-lane runs at loads 4.4–12.08; both its own feature and
BL-1600's feature green; `required_wiring` OK; register row removed at
commit `b4ec85fbd7`, clean QA evidence `47e50af7ee`). Attempting
`bb swarmforge/scripts/land_step_cli.bb BL-1607 47e50af7ee` hits the
IDENTICAL refusal, same shared evidence file, same
`ENTANGLED_SIBLING` set minus BL-1607 itself plus BL-1608:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1185
ENTANGLED_SIBLING BL-1576
ENTANGLED_SIBLING BL-1599
ENTANGLED_SIBLING BL-1605
ENTANGLED_SIBLING BL-1608
BL-1607: entangled tip - sibling ticket(s) BL-1185,BL-1576,BL-1599,BL-1605,BL-1608
unlanded as ancestors, tip-pure replay could not complete cleanly; specifier
adjudication needed.
```

Same structural cause (Article 4.4 escalation discipline: one escalation
per class) — not re-sent as a second priority-00 note, appended here
instead. Both BL-1607 and BL-1608 are QA-approved and waiting on this
same adjudication; whatever resolves one likely resolves both in one
pass. Continuing to BL-1599 next.

## Same structural blocker recurs a third time on BL-1599 (same pass)

BL-1599 also fully verified and QA-approved: unit suite green apart from
BL-1605's already-bounced, unrelated defect (confirmed twice more, one
transient unrelated flake on a third run not reproduced on a fourth);
its own acceptance feature 5/5 green; hardener mutation pass 100% kill
(77/77 Stryker mutants + 8 hand-authored + 27 Gherkin outline mutants);
`SUITE_DURATION_BUDGET_MS`/`PER_FILE_DURATION_BUDGET_MS` unchanged,
`SUITE_WORK_BUDGET_MS`=550000/`SUITE_WORK_TOLERANCE`=0.10 introduced as
specified; `work_budget_verdict` recorded; documentation added to
`docs/reference/Specification.MD` accurately. `required_wiring` OK.
Clean QA evidence `f2d20f4da9`. Attempting
`bb swarmforge/scripts/land_step_cli.bb BL-1599 f2d20f4da9` hits the
IDENTICAL refusal:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1185
ENTANGLED_SIBLING BL-1576
ENTANGLED_SIBLING BL-1605
ENTANGLED_SIBLING BL-1607
ENTANGLED_SIBLING BL-1608
BL-1599: entangled tip - sibling ticket(s) BL-1185,BL-1576,BL-1605,BL-1607,BL-1608
unlanded as ancestors, tip-pure replay could not complete cleanly; specifier
adjudication needed.
```

Same structural cause, third instance this pass — appended here per the
same escalation discipline. **All four reviewed tickets from this
documenter batch are now dispositioned**: BL-1608, BL-1607, BL-1599 are
QA-approved and blocked only on this land-step adjudication; BL-1605 is
bounced to coder (independent, unrelated defect) and not part of the
entanglement blocking the other three's land — once this adjudication
resolves, BL-1608/1607/1599 can land together (or in sequence) without
carrying BL-1605's still-unresolved file, since none of the three
approved tickets' own paths overlap it.

## The refusal shape changed after merging BL-1604's own fix (same pass)

BL-1604 (the land-step's own register-row-restoration fix, also
QA-reviewed this pass — see its bounce/resolution below) landed into
this QA branch at `a0e149f224`. Re-running
`bb swarmforge/scripts/land_step_cli.bb BL-1608 a0e149f224` now (BL-1604's
fix live in-tree, though not yet landed on `origin/main`) produces a
DIFFERENT, more specific refusal — BL-1604's own new content-check
(BL-1332/BL-1375/BL-1481 shape) now runs and finds a real attribution
gap of its own:

```
LAND_ESCALATE
ENTANGLED_SIBLING BL-1185
ENTANGLED_SIBLING BL-1576
ENTANGLED_SIBLING BL-1599
ENTANGLED_SIBLING BL-1604
ENTANGLED_SIBLING BL-1605
ENTANGLED_SIBLING BL-1607
ENTANGLED_SIBLING BL-1610
BL-1608: entangled tip - sibling ticket(s) BL-1185,BL-1576,BL-1599,BL-1604,
BL-1605,BL-1607,BL-1610 unlanded as ancestors, tip-pure replay could not
complete cleanly; specifier adjudication needed.
land-step: refusing to replay BL-1608 - backlog/standing-reds.tsv is shared
with unlanded sibling(s) BL-1185 (unreadable: no backlog ticket file found
for BL-1185), and the tip's content differs from origin/main in a line
attributable to the sibling, so a replayed path is taken whole and would
carry it into main (BL-1332/BL-1375, content-checked per BL-1481)
```

BL-1185 is not a live ticket — it was retired 2026-08-27 via merge-up and
has no `backlog/{paused,active,done}` file at all (its feature is the
contract; see `docs/how-to` note on this in BL-1608's own mint record).
It appears as an `ENTANGLED_SIBLING` only because its name is quoted in
prose inside commit subjects/messages along this chain (e.g. "BL-1185's
own feature now resolves 4/4"), and the attribution walk cannot resolve
an owner-state for a ticket id with no backlog file, so it fails closed
per BL-1546 rather than assume it is closed/absent-and-safe.

`BL-1610` is newly entangled too — not seen in the two earlier attempts
this pass, before BL-1604's fix was in-tree — since BL-1604's own
description and the specifier's amendment (`backlog/active/BL-1604-*.yaml`
"AMENDED 2026-09-17 07:00Z") reference BL-1610's gate defect directly.
QA has not yet received or reviewed a BL-1610 parcel.

This is a distinct, deeper layer of the same class (shared-registry /
prose-referenced-ticket attribution at the land step), not a new class —
still appended here rather than a fresh note. Not something QA can
resolve by hand-rebuilding (per BL-1241 item 2, a hand-rebuild's own-path
walk would not agree with this check by construction); this stays with
the specifier's pending adjudication, which now additionally needs to
cover: (a) how a retired, fileless ticket id referenced only in prose
should resolve in the attribution walk, and (b) BL-1610's relationship to
this batch once QA receives it.

## BL-1610 itself, now reviewed, hits the same class from a third angle

BL-1610 (the merge-drop gate's own scan-bound fix — the mechanism behind
several of this thread's own findings) is QA-approved: bb test runner and
property runner green, both scenarios of its own feature (6/6) and
BL-1576's regression feature (11/11) green, `required_wiring` OK, the
qa_e2e_procedure's own reproduction independently re-run by QA
(`bb merge_drop_guard_lib.bb .worktrees/documenter 4356ab57c1 6ad1d3f616
073a34b5e1` → 0 findings; without the head arg → 1 excused finding on
`c96761faa1`, matching spec exactly), docs and the diagram trigger
updated. Clean QA evidence `6ca79b8ddc`.
`bb swarmforge/scripts/land_step_cli.bb BL-1610 6ca79b8ddc` refuses too,
a third flavor of the same class:

```
land-step: refusing to replay BL-1610 - backlog/standing-reds.tsv's attribution
is ambiguous: 93f2031c3b names BL-1185,BL-1608 and leads with neither, and no
commit of BL-1610's own touches backlog/standing-reds.tsv - never decided
silently (BL-1544)
```

That cited commit is QA's OWN revert (the fix for the very first finding
in this thread, restoring the coder's discharged BL-1185/BL-1608 row).
**All five tickets touched this pass are now dispositioned**: BL-1608,
BL-1607, BL-1599, BL-1610 QA-approved and blocked only on this land-step
adjudication; BL-1605 bounced to coder, independent and unentangled.
Nothing further to review; awaiting the specifier.

## Rerun after the specifier's BL-1576 stray-file fix (aaed2cab79) — deeper layer confirmed, not cleared

Specifier note (resume, in_process): "BL-1608/1607: stray BL-1576 file
landed aaed2cab79 - fetch, rerun land_step_cli." `git fetch origin`:
`main`==`origin/main` (0/0), tip `501d80deaf`. Re-ran both as directed:

```
$ bb swarmforge/scripts/land_step_cli.bb BL-1608 9bdf467215
LAND_ESCALATE
ENTANGLED_SIBLING BL-1185
ENTANGLED_SIBLING BL-1599
ENTANGLED_SIBLING BL-1604
ENTANGLED_SIBLING BL-1605
ENTANGLED_SIBLING BL-1607
ENTANGLED_SIBLING BL-1610
land-step: refusing to replay BL-1608 - backlog/standing-reds.tsv is shared
with unlanded sibling(s) BL-1185 (unreadable: no backlog ticket file found
for BL-1185), and the tip's content differs from origin/main in a line
attributable to the sibling, so a replayed path is taken whole and would
carry it into main (BL-1332/BL-1375, content-checked per BL-1481)

$ bb swarmforge/scripts/land_step_cli.bb BL-1607 47e50af7ee
LAND_ESCALATE
ENTANGLED_SIBLING BL-1185
ENTANGLED_SIBLING BL-1576
ENTANGLED_SIBLING BL-1599
ENTANGLED_SIBLING BL-1605
ENTANGLED_SIBLING BL-1608
land-step: refusing to replay BL-1607 - backlog/standing-reds.tsv is shared
with unlanded sibling(s) BL-1185 (unreadable: no backlog ticket file found
for BL-1185), and the tip's content differs from origin/main in a line
attributable to the sibling, so a replayed path is taken whole and would
carry it into main (BL-1332/BL-1375, content-checked per BL-1481)
```

The BL-1576 stray-evidence-file fix resolved the shallow (BL-1546)
refusal it targeted — neither run hits that refusal any more — but
BOTH runs now hit the exact same deeper refusal already reported above
("The refusal shape changed after merging BL-1604's own fix" section):
`backlog/standing-reds.tsv`'s content differs from `origin/main` in a
line attributed to BL-1185, a ticket retired 2026-08-27 with no
`backlog/{paused,active,done}` file, so the attribution walk cannot
resolve an owner-state and fails closed per BL-1546. This is the same
BL-1185-fileless-ticket class flagged in this file before the specifier's
adjudication landed, not a new class, and not cleared by that
adjudication — that fix targeted a different path
(`backlog/evidence/BL-1576-...md`) than the one now blocking
(`backlog/standing-reds.tsv`).

Still not something QA can resolve by hand-rebuild (BL-1241 item 2: a
hand rebuild's own-path walk would not agree with this check by
construction). BL-1608 and BL-1607 remain QA-approved and blocked only
on this land-step adjudication, now narrowed to one concrete question:
how should the attribution walk resolve `backlog/standing-reds.tsv`'s
line(s) attributed to BL-1185 when BL-1185 has no backlog ticket file at
all (retired via merge-up, 2026-08-27)?

## Rerun after merging origin/main fully into the QA branch (specifier's follow-up note) — same result, root cause pinpointed

Second specifier resume note (in_process, queued ahead of the note
above): "BL-1608/1607: merge main aaed2cab79 into QA first, then
land_step_cli on QA tip." Per the how-to's sync-first discipline: `git
merge origin/main --no-edit -m "Merge main 501d80deaf into QA."`
(clean, no conflicts, untagged subject) onto tip `287ef562e7`, new tip
`227a4b2ee5`. Re-ran both on this fully-synced tip:

```
$ bb swarmforge/scripts/land_step_cli.bb BL-1608 227a4b2ee5
LAND_ESCALATE ... same backlog/standing-reds.tsv / BL-1185 refusal

$ bb swarmforge/scripts/land_step_cli.bb BL-1607 227a4b2ee5
LAND_ESCALATE ... same backlog/standing-reds.tsv / BL-1185 refusal
```

Identical to the pre-sync result — the sync did not clear it, since this
is a genuine content difference, not a staleness artifact. Pinpointed
the exact cause: `git log -S"BL-1185-work-note-missing-task-header-defers-hard-seat.feature"
-- backlog/standing-reds.tsv` finds three touching commits; the relevant
one is **QA's own** `93f2031c3b`, subject "Revert fb9a53751e's
wrongly-reintroduced BL-1185/BL-1608 standing-red row" (2026-09-17
07:32:38+01:00, this same QA branch, part of the D1-retraction
correction earlier in this pass). The subject text names "BL-1185"
before "BL-1608" (as the compound "BL-1185/BL-1608"), and the
attribution walk resolves ownership from the first ticket id token in a
commit subject — so it reads this commit, and the standing-reds.tsv line
it touches, as BL-1185's, not BL-1608's. The commit's own content is
correct (it reverts a wrongly-reintroduced row belonging to BL-1608; see
its full body) — only the SUBJECT WORDING misleads the walk, the same
"a commit subject naming two tickets attributes to whichever the walk
reads first" class as BL-1617 (which covers a *closed* ticket leading a
subject; BL-1185 is not closed, it has no backlog file at all, so
BL-1546's fail-closed clause fires the same way).

QA cannot fix this by rewriting `93f2031c3b`'s message: it is not at the
branch tip, and an interactive rebase to reword it is out of policy
(rewrites every descendant SHA already cited in this pass's evidence and
handoffs). Per BL-1241 item 3/4: rematch attempted once (the sync above),
still not clean — stopping here per that discipline rather than looping.
BL-1608 and BL-1607 remain QA-approved, blocked only on this adjudication.
Root cause is now precise enough to fix at its source: either (a) the
specifier lands a corrective commit whose own subject leads with BL-1608
and touches `backlog/standing-reds.tsv` (giving the attribution walk a
later, correctly-attributed touch on the same path to prefer), or (b)
the attribution walk itself is amended to ignore a non-leading ticket
token, or a ticket id with no resolvable backlog file, when a leading
token already resolves. Not QA's call.

By QA.
