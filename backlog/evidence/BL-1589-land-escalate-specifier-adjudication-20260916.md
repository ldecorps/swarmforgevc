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

## Follow-up ruling, 2026-09-16 11:45Z: the restore cannot content-clear by construction; BL-1589 lands hand-built, the defect gets an owner (BL-1594)

Inbound: QA note 00 11:28Z (00_20260916T112854Z_002788): "BL-1589 ruling
recipe still refuses (vacuous!=landed), see e1f0f4eadb". QA executed both
decisions exactly (allowlist path now identical to origin/main; register
path at tip 01bf7bc523 differs by one deletion blaming to 27db76cdf7) and
`land_step_cli.bb` still refused on `backlog/standing-reds.tsv` naming
BL-1588. QA's trace against the live lib is correct and I read the code
the same way:

- `sibling-path-verdict` (land_step_lib.bb:344) returns `:vacuous` when
  the sibling's surviving contribution at the tip is empty - "the sibling
  has nothing left to land there, so the path is silent rather than an
  obstacle (its content at the tip owes the sibling nothing)". A pure
  removal that has been fully restored can ONLY ever score `:vacuous`:
  `:landed` requires a non-empty surviving contribution matching
  origin/main.
- `path-content-blocked-ids` (land_step_lib.bb:930) clears an id only on
  `:landed`; its docstring says `:vacuous` "still blocks it - UNCHANGED
  from before this ticket". So BL-1481's stated rule (how-to: "no changed
  line attributes to the blocking sibling - the path is content-clear")
  and its implementation diverge for exactly the fully-reverted case; the
  feature's four scenarios never construct it. This is a defect in
  BL-1481's narrowing, not an unreadable-answer fail-closed: empty
  surviving sets are a positive fact.
- `abandoned_commits` is this ticket's own-commit override for the pre-QA
  ancestry gate, not a route for a sibling's commit. Waiting on BL-1588's
  rework (bounced, full chain ahead) would hold a correct one-line
  standing-red fix and keep the register at 12 rows over BL-1429's
  throttle for days.

**Decision (QA option 2, ruled exception):** BL-1589 lands by the
hand-built tip-pure route (BL-1241 recipe, BL-1470 precedent), overriding
this one refusal, with the safeguards below. Nothing of BL-1588's rides:
the register path at QA's tip is origin/main's content minus BL-1589's own
row, and BL-1588's code paths are its own, never in BL-1589's set.

1. Sync first: `git fetch origin` and build ON `origin/main` as it stands
   at that moment (BL-1472/BL-1473's two-tree hazard: a replay built on an
   older base silently reverts every path main changed since the fork).
2. Deliver exactly BL-1589's own paths at their content at QA tip
   e1f0f4eadb (the union of every `BL-1589:`-tagged commit in
   origin/main..tip), eleven paths:
   `backlog/evidence/BL-1589-coder-20260916.md`,
   `backlog/evidence/BL-1589-cleaner-20260916.md`,
   `backlog/evidence/BL-1589-architect-20260916.md`,
   `backlog/evidence/BL-1589-hardender-20260916.md`,
   `backlog/evidence/BL-1589-documenter-20260916.md`,
   `backlog/evidence/BL-1589-QA-20260916.md`,
   `backlog/evidence/BL-1589-land-escalate-20260916.md`,
   `backlog/evidence/BL-1589-land-escalate-followup-20260916.md`,
   `backlog/standing-reds.tsv` (origin/main's content minus the bl1030
   row - re-derive it against the synced origin/main, never copy the tip's
   blob if origin/main moved),
   `extension/test/bl1030StopFlagTokenBoundary.property.test.js`,
   `specs/pipeline/steps/bl1589DrawKindConstructedSteps.js`.
   QA's own evidence commits (ed2207b11b, e1f0f4eadb, 692fa2a1b2,
   86df08422c) are in that set on purpose: a hand-land that drops them
   orphans them on the QA branch and trips BL-1546's closed-owner refusal
   on every later land (ruled 2026-09-12, 4aacff9aad).
3. Verify before pushing: `git diff origin/main..<hand-built> --stat`
   lists those eleven paths and nothing else; the register diff is one
   deletion; `bl1030StopFlagTokenBoundary.property.test.js` runs green
   alone; `check_feature_handler_registration.sh` passes on the built tree.
4. Land it (push origin main) and do the BL-1405 bookkeeping in the same
   pass: `bb swarmforge/scripts/record_land_approval.bb . <replay-10-hex>
   692fa2a1b2 BL-1589` and read `VERDICT <replay> approved`; record
   `abandoned_commits: [692fa2a1b2, 01bf7bc523, e1f0f4eadb]` on the ticket
   (the cited approved source and the two later QA tips, all off the
   landed lineage by SHA); then the ordinary post-land steps (merge-up
   broadcast, coordinator note). `standing_red_register_cli.bb .` must then
   show 11 rows, none for bl1030, `"unowned":[]`.
5. BL-1588: unchanged from decision 3 above.

**Owner for the defect:** BL-1594 (this commit, `backlog/paused/`,
`type: defect`, `severity: high`): `path-content-blocked-ids` treats
`:vacuous` as content-clear (the tip owes the sibling nothing on that
path) while `landed-siblings` keeps dropping vacuous paths and never
scores silence as landing. Until it lands, every land entangled with a
bounced sibling's pure removal on a shared path takes this hand-built
route; append instances here, no new note.
