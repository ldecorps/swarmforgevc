# BL-1641 — hardener finding: pre_qa_gate ancestry FAIL on a land-replay branch

Ran `bash swarmforge/scripts/pre_qa_gate.sh BL-1641 <current-tip>` as a
self-check (not part of the standard hardener checklist - QA's own
pre-approval gate) while re-verifying the lineage-fix QA's bounce asked
for. Output:

```
PRE_QA_GATE WARNING: ancestry BL-1641 1dd3de8f61 subject-only on swarmforge-documenter (no path overlap with parcel)
PRE_QA_GATE WARNING: ancestry BL-1641 2bbdab9c0b subject-only on swarmforge-documenter (no path overlap with parcel)
PRE_QA_GATE_FAIL ancestry BL-1641 cf7d8c460f stranded on land-replay/BL-1641-9097b85058
```

The two WARNING lines are the benign subject-only shape. The FAIL names
`cf7d8c460f` ("BL-1641: tip-pure replay onto origin/main (BL-1241
land-step remedy)") on branch `land-replay/BL-1641-9097b85058` - a
standard `land_step_lib.bb` artifact branch (its own naming convention,
`land-replay/<ticket>-<short-sha>`), containing a FULL tip-pure replay of
BL-1641's own paths including a `BL-1641-QA-20260921.md` evidence file -
i.e. QA appears to have already run `land_step_cli.bb` against an
approved BL-1641 commit at some point this session, building this
replay branch, before the ancestry issue (this same bounce) was found
and the land did not complete/was not the chain that reached QA's
approval this time.

**Not fixed here**: resolving a stray `land-replay/` branch is land-step
machinery, QA/specifier territory (`land_step_lib.bb`'s own domain), not
the hardener's. My own checklist (unit/acceptance/property tests, the
production gate, standing guards) is entirely clean - see the paired
`BL-1641-hardener-20260921-3.md` verdict. Confirmed this FAIL does not
block MY OWN forward: `pre_qa_gate_lib.bb`'s `gate-armed?` only arms for
a `git_handoff` whose `to:` includes QA (`swarm_handoff.bb`'s own
`validate`), and this parcel's forward is `to: documenter`.

Flagged by note (priority 00) to the specifier so it is visible before
this reaches QA again, rather than silently forwarded.

By hardener.
