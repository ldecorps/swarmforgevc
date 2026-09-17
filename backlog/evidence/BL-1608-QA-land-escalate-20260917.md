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

By QA.
