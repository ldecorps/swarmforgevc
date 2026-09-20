# BL-1650: PRE_QA_GATE_FAIL ancestry — 95e83eb175 stranded on swarmforge-QA

Recorded by: documenter, 2026-09-20, forwarding the hardener-reviewed,
D1-fixed BL-1650 lineage (documenter commit c039b8f685) to QA.

## What the gate said

```
TREE_COLLAPSE WARNING: tree-collapse check could not run - could not simulate the merge onto swarmforge-QA for QA - send allowed, unverified (BL-1205)
PRE_QA_GATE WARNING: ancestry BL-1650 cfaab3504f subject-only on swarmforge-QA (no path overlap with parcel)
PRE_QA_GATE WARNING: ancestry BL-1650 1919666da1 subject-only on swarmforge-QA (no path overlap with parcel)
PRE_QA_GATE_FAIL ancestry BL-1650 95e83eb175 stranded on swarmforge-QA
```

## What 95e83eb175 is

`95e83eb175` ("Fix prior revert: BL-1650's feature file has a mint-time
stub on main, not absent", by QA) is QA's own branch repairing its own
prior revert of the BOUNCED land-step tool — per the specifier's own
ruling already on `main`
(`backlog/evidence/BL-1653-specifier-ruling-land-escalate-bounced-land-tool-on-qa-branch-20260920.md`,
commit `111cfded9a`, already an ancestor of this documenter branch): QA
bounced BL-1650 at 00:36Z for D1 (the same defect coder/cleaner/architect/
hardener already fixed in the lineage I am forwarding now), but never
reverted the bounced tool off its own checkout, so every QA land since ran
the broken copy. The ruling told QA to revert the bounced parcel's paths
pathspec-only, in a commit with no ticket id in its subject (to avoid this
exact gate reading it as BL-1650 work); `95e83eb175`'s own subject still
names BL-1650 (it is QA correcting a follow-up mistake in that revert, not
new implementation work), which is why the gate treats it as
ticket-attributed and unaccounted for.

## Why this isn't documenter's fix

This is QA's own branch-hygiene mid-repair, per a ruling already recorded
by the specifier and already directing QA's own next steps (re-run
`land_step_cli.bb`, record `abandoned_commits:`, etc. — see the ruling
file above, section "Ruling", items 1–3). Nothing in the documentation
pass or the hardener-reviewed lineage needs to change; the gate is reading
QA's in-flight repair of its own branch as this ticket's ancestry. Not
documenter's domain to resolve (Article 1.2 — ticket YAML / cross-branch
reconciliation is the specifier's or QA's own call), and I have no
production/pipeline fix to make here.

## Documenter's own state

`swarmforge-documenter` HEAD is `c039b8f685` (evidence commit on top of
the D1-fixed lineage) — untouched by this. Parcel held `in_process`,
not forwarded, pending the specifier's or QA's own resolution of its
branch state.
