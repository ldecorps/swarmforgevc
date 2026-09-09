# Article 4.2 / BL-247 escalation on 7b3d2108fc — FALSE POSITIVE (operator, 2026-09-04T21:20:56Z)

BABYSITTER_ESCALATION `pipeline-code-on-main-7b3d2108fc` flagged
`BL-1399: tip-pure land -- own paths only, replayed onto origin/main`
(author t <t@t>, 2026-09-04T21:14:08Z) as "pipeline code landed on main
outside QA" for:

- extension/test/bl1012FreshnessSelfInflictedIncidents.property.test.js
- extension/test/bl1399FreshnessFixtureOwnRegistry.property.test.js
- specs/pipeline/steps/bl1399FreshnessFixtureOwnRegistrySteps.js

## Why it is a false positive

This is the standing class already recorded eight times in this directory
(`babysitter-article42-qa-handland-on-main-false-positive-20260904.md`,
`...-bl1390-...`, `...-bl1386-bl1387-...`, `...-bl1362-...`, `...-bl1358-...`,
`...-expedite-lane-land-...`, `...-union-merge-...`, `...-expedite-rematch-...`).

The Article 4.2 predicate (`swarmforge/scripts/is_qa_ancestor.sh`) is
**ancestry-only**: approval requires the sha to be an ancestor of
`swarmforge-QA`. The BL-1376 tip-pure hand-land route pushes the replay to
`origin/main` FIRST and merges it back into `swarmforge-QA` AFTERWARDS, so the
predicate necessarily reads "unapproved" for the gap between those two steps.

That makes this a **race window, not a permanent state** — the same shape as
`485fd43bce` (BL-1358, ~8 min window) and `0dab987fac` (BL-1362, escalation
fired ~40s before the merge-back closed it); both returned rc=0 when the
predicate was re-run after the merge-back. Here the land is 21:14:08Z and this
check ran at 21:19Z with QA still mid-broadcast in-pane — i.e. **inside the
window**. Expect it to self-clear on QA's merge-back; re-running
`is_qa_ancestor.sh 7b3d2108fc` after that should return 0.

## Verification performed (operator, read-only)

- `is_qa_ancestor.sh 7b3d2108fccaf91d8e4d5dfaf56156e1ab479997` → exit 1.
  Exit 1 is "not an ancestor **or** QA bounced it"; the bounce arm is ruled
  out below, so the "no" is purely the ancestry arm.
- **No bounce verdict names this sha**: no hit for `7b3d2108fc` in
  `.swarmforge/bounces/` nor as a `commit:` in any tracked
  `bounce_history`. (BL-1399 *does* carry `bounce_count: 1`, but on
  `152bae1089`, a different parcel, already reworked.)
- **Content is byte-identical to the QA tip** — blob SHAs compared against
  `swarmforge-QA` (b2f822150d) for all three flagged paths:
  - bl1012FreshnessSelfInflictedIncidents.property.test.js → f6276325a7 (SAME)
  - bl1399FreshnessFixtureOwnRegistry.property.test.js     → 336dfb030b (SAME)
  - bl1399FreshnessFixtureOwnRegistrySteps.js              → 943ce1b41c (SAME)
  So the code on main is exactly what QA reviewed; only the commit's
  ancestry differs.
- QA pane confirms it authored this land in-flight: LAND_ESCALATE recorded
  in `BL-1399-land-escalate-20260904.md`, `abandoned_commits: [174391df60]`
  written onto the ticket, then the replay onto origin/main.
- Single-parent commit; `origin/main...main` = 0/0; no MERGE_HEAD.

## Disposition

No action. Not a policy breach, not an unreviewed land: the code on main is
byte-for-byte what QA reviewed, and the alarm is expected to self-clear on
QA's merge-back (third reproduction of the BL-1358/BL-1362 race in one day —
every tip-pure hand-built replay raises one Art 4.2 CRIT that closes itself
within ~6-10 min).

A durable fix would either delay babysitter's gather past QA's merge-back, or
widen the predicate beyond ancestry — content-identity against the
`swarmforge-QA` tip, as computed above, answers correctly *inside* the window
and needs no timing assumption at all.
