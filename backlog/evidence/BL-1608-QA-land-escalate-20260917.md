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

By QA.
