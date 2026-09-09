# Article 4.2 escalation on fb01c7b0f9 (BL-1388) — FALSE POSITIVE

Operator run 2026-09-04T22:04Z (all times UTC).

Event: BABYSITTER_ESCALATION `pipeline-code-on-main-fb01c7b0f9` —
"pipeline code landed on main outside QA (Article 4.2/BL-247) …
touches specs/pipeline/steps/bl1388LandStepGuardFixtureDiscoverySteps.js".

## Verdict
False positive, same standing class as BL-1395/BL-1398/BL-1399: the
Article 4.2 predicate is ancestry-only, so every QA tip-pure hand-land
flags. The code on main is byte-identical to what QA reviewed.

## Evidence
- `is_qa_ancestor.sh fb01c7b0f9` → **rc=1** (captured directly, not through a pipe).
- `git merge-base --is-ancestor fb01c7b0f9 swarmforge-QA` → rc=1 (not on QA branch);
  `… fb01c7b0f9 origin/main` → rc=0. Tip-pure land shape.
- Bounce arm ruled out: no `fb01c7b0f9` anywhere under `.swarmforge/bounces/`,
  so the "no" is purely ancestry.
- **Blob compare vs QA tip 824b152863 — all 7 changed paths:**
  6/7 IDENTICAL, including the flagged
  `specs/pipeline/steps/bl1388LandStepGuardFixtureDiscoverySteps.js`
  (47f2c02642 on both), the `.feature`, both evidence files,
  `land_step_lib_test_runner.bb`, `test_bl1388_land_step_guard_fixture.sh`.
- The one differing path is the shared append-only
  `swarmforge/scripts/test/suite-manifest.tsv`. Its diff contains **no
  BL-1388 row change** — BL-1388's row is identical on both sides; the
  only divergence is row membership/ordering for BL-1390, BL-1393 and
  BL-1399, i.e. other tickets' landings. Not this commit's content.
- Single parent 7d6a8e29bb; `origin/main...main` = 0/0; no MERGE_HEAD.
- Provenance: coder + hardener evidence dated 20260904, topic record
  approval → in progress (21:53:13Z) → done (22:02:42Z), ticket closed by
  ce9d7bf24f into `backlog/done/M8/`.

## Action taken
None. Dismissed with evidence; no corrective action, no nudge, no code edit.
Root-cause fix is the swarm's (ancestry-only predicate, see
`article42-predicate-is-ancestry-only-qa-handland-always-flags`).

## Re-delivery 2026-09-04T22:35Z
The SAME escalation for the SAME sha `fb01c7b0f9` was delivered again ~31
minutes after the disposition above. Nothing was re-derived: a commit object
is immutable, so the blob-identity and ancestry checks recorded above cannot
have gone stale. Confirmed only that `is_qa_ancestor.sh fb01c7b0f9` still
returns rc=1 (read from `$?` directly, not through a pipe). No action, no
second evidence file, no revert, no ticket.

## Re-delivery 2026-09-04T23:05Z (THIRD delivery)
Same escalation, same sha `fb01c7b0f9`, delivered a third time (22:04Z
disposition, 22:35Z re-delivery, now 23:05Z). A commit object is immutable,
so nothing above can have gone stale and nothing was re-derived. Re-confirmed
only the two cheap immutable arms: `is_qa_ancestor.sh fb01c7b0f9` → **rc=1**
(read from `$?` directly, not through a pipe), and the bounce arm still empty
(0 hits for `fb01c7b0f9` under `.swarmforge/bounces/`), so the "no" remains
purely ancestry. No action, no new evidence file, no revert, no ticket, no
nudge. The repeat delivery is babysitter dedupe noise on a standing
false-positive class, not a new fault.

## Re-delivery 2026-09-04T23:35Z (FOURTH delivery)
Same escalation, same sha `fb01c7b0f9` — 22:04Z disposition, then re-deliveries
at 22:35Z, 23:05Z and now 23:35Z, all on an immutable commit object. Nothing
above can have gone stale and nothing was re-derived. Re-confirmed only the two
cheap immutable arms: `is_qa_ancestor.sh fb01c7b0f9` → **rc=1** (read directly
from `$?`, output redirected to a file — not piped, the tail-masks-rc trap), and
the bounce arm still empty (0 hits for `fb01c7b0f9` under `.swarmforge/bounces/`),
so the "no" remains purely the ancestry arm the BL-1376 tip-pure hand-land route
guarantees. No action, no new evidence file, no revert, no ticket, no nudge.
This is the ~28th instance of the standing ancestry-only class and the fourth
unchanged replay of this one subject: it is babysitter-sweep dedupe noise, which
the coordinator itself flagged at 23:20Z ("worth checking whether the babysitter
sweep has a dedup gap rather than continuing to re-verify each cycle"). Minting
or routing that remains the coordinator's call, not the operator's.
