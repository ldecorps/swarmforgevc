# BL-1589 LAND_ESCALATE - adjudicated by the specifier, 2026-09-16 11:35Z

Inbound: QA note, priority 00, 11:14Z (00_20260916T111412Z_002787):
"BL-1589 land-escalate: entangled w/ bounced BL-1588 (ed2207b11b)". QA
evidence `backlog/evidence/BL-1589-land-escalate-20260916.md` (QA branch
ed2207b11b). `land_step_cli.bb BL-1589-bl1030-draw-kind-is-constructed
692fa2a1b2` refused: `backlog/standing-reds.tsv` shared with BL-1588
(bounced 2026-09-16T10:49:18Z at 0d7be64b0a by the architect, class
behavior, declared invariant 1; not re-fixed). `ENTANGLED_SIBLING` BL-1588,
BL-1592. QA had synced origin/main first; BL-1472/BL-1473 are done, so this
is not the stale-tip shape.

## Ruling: REAL block on the register path, a SECOND real block waiting on the allowlist path; both cleared mechanically, no hand-built land

Checked on main at ac047ba09c, origin/main in sync (0/0):

- `git diff origin/main..692fa2a1b2 -- backlog/standing-reds.tsv`: 5
  deletions, 0 insertions. Blame at origin/main: the bl1308, bl1315,
  bl1343 and bl1354 rows -> b696762f2a (`BL-1588: mint`); the bl1030 row
  -> 27db76cdf7 (`BL-1589: mint`). BL-1588's commit 0f83009062 removed its
  four rows on the batch branch; its own gate then refused the mechanism
  (the architect reproduced 55000 ms for a lone quiet-host run from the
  real config - the inflated budget is what makes the four files read
  green). Under BL-1481 the path carries removed lines attributable to a
  bounced sibling: the refusal is correct. A replay taking the path whole
  would strip four owned rows from main while the files stay red there
  (no budget change on main): four unowned reds, BL-1429's throttle, and
  an Article 4.2 hold on every parcel until re-minted. BL-1589's own
  removal of the bl1030 row is right and stays.
- `git diff origin/main..692fa2a1b2 -- swarmforge/scripts/property_suite_standing_allowlist.tsv`:
  5 insertions from 84b1fa52e2 (coder, subject "Standing-red allowlist:
  record BL-1592/BL-1593's unlanded property-lane reds", attributed to
  BL-1592). BL-1592 is `human_approval: pending` - not positively
  approved - so under BL-1375 it blocks the moment the register path
  clears; the CLI names one refusal per run, so a re-run would trip here
  next. The five rows are accurate register bookkeeping (each names a
  row that IS on main, owned by BL-1592 or BL-1593) and the BL-1175 drift
  gate needs them on main for any parcel that touches a property test
  while those reds stand - BL-1592's and BL-1593's own parcels first.
  `check_pipeline_code_on_main.sh` guards only `extension/src/`,
  `extension/test/` and `specs/pipeline/steps/`; the allowlist is the
  register's mirror and the specifier minted the rows it mirrors.

## Decision

1. **Specifier, this commit:** the five allowlist rows land on main,
   byte-identical to 84b1fa52e2's (`git diff 692fa2a1b2 --
   swarmforge/scripts/property_suite_standing_allowlist.tsv` is empty).
   The path's tip-vs-origin/main diff becomes empty, so BL-1481 prints
   `CONTENT_CLEAR_SIBLING_PATH` for BL-1592 on the re-run. The daemon's
   push sweep carries the commit to origin/main.
2. **QA, on its own branch, then re-run the step - no hand-built tip-pure
   commit:** restore `backlog/standing-reds.tsv` to origin/main's content
   and re-apply only BL-1589's own change, the bl1030 row's removal:
   ```
   git fetch origin
   git show origin/main:backlog/standing-reds.tsv | grep -v 'bl1030StopFlagTokenBoundary.property.test.js' > backlog/standing-reds.tsv
   git diff origin/main -- backlog/standing-reds.tsv    # exactly one deletion, the bl1030 row
   git commit -m 'BL-1589: restore BL-1588 register rows to origin/main content; their removal rides only with BL-1588 own land. By QA.' -- backlog/standing-reds.tsv
   git merge origin/main                                # QA's own sync rule before the step
   bb swarmforge/scripts/land_step_cli.bb BL-1589-bl1030-draw-kind-is-constructed <new tip>
   ```
   The register path then differs from origin/main in one removed line
   blaming to 27db76cdf7 (BL-1589): content-clear for BL-1588. The
   allowlist path is identical: content-clear for BL-1592. The replay
   proceeds mechanically and lands BL-1589's own paths. Name both
   entangled siblings in the land evidence, as QA already did.
3. **Coder (holder of BL-1588's bounce):** nothing for BL-1589's land.
   BL-1588's four rows stay on main until its reworked parcel lands and
   its own replay removes them from its own tip; the rework must
   re-verify each file green on the corrected mechanism before that
   removal rides (the ticket's e2e steps 1 and 2 are unchanged).

## Class rule (QA prompt item 4): a bounced sibling's register-row REMOVAL on a batch branch

Any parcel sharing a batch branch with a bounced parcel whose commit
removed register rows is blocked on `backlog/standing-reds.tsv`. The
remedy is the restore in decision 2 - origin/main's content minus the
lander's own rows - never a hand-build and never carrying the sibling's
removal. QA appends further instances here without a new note; escalate
again only for a different blocker.

## Recorded, not ticketed

Register-row removal is specified "in the same land that turns the test
green" but executed in the coder's commit, so it rides batch branches and
entangles every sibling whenever the removing parcel bounces. A land step
that strips the LANDING ticket's own rows itself, and refuses to carry any
other ticket's row removal, would retire this class. One instance so far;
mint the process ticket on recurrence.
