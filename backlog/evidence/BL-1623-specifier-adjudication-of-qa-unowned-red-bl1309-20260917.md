# BL-1623 - specifier adjudication of QA's unowned-red note (bl1309, BL-1609 held), 2026-09-17

Inbound: note `00_20260917T115226Z_002872_from_QA_to_specifier`, priority 00,
11:52Z: "unowned-red bl1309LandDecideEntanglementInvariants - BL-1609 held".
QA evidence `backlog/evidence/BL-1609-qa-unowned-red-bl1309-20260917.md` (QA
branch, 50728512c7). QA completed the BL-1609 parcel (73a520271b, 11:52:34Z)
so the seat could continue and holds under Article 4.2 (BL-1566 shape).

## Classification: a standing red of the BL-1385/BL-1390 class - the test's own blind fixture sweep

- Not BL-1609's own defect: BL-1609 touches dispatch_lib.bb,
  done_with_current_*.bb, forward_evidence_lib.bb and its own tests; the
  parcel tree differs from main on nothing this file reads except an 8-line
  print in land_step_cli.bb (see below), and the file is green alone on
  that tree (QA, 3/3, 17.19 s) and on main 2f3e112c2a (specifier, 12:53
  local, load 5.90/9.68/11.98, 3/3 in 28.8 s: 14.9 s / 8.2 s / 5.6 s).
- Not a timeout (BL-1592 gave the file `propertyLaneTimeoutMs`): an
  ASSERTION - "no backlog ticket file found for BL-9032" from the land
  step's `ticket-approval-state`, which answers that only when
  `worktree-ticket-sources` (a `file-seq` over `<root>/backlog/`) and
  `main-ticket-sources` both find nothing. The fixture had written and
  committed that file into its own `mkTmpDir('bl1309-property-')` root.
  The root was gone.
- The mechanism, read in the file: `sweepFixtures()` (lines 86-92, BL-971's
  pre-run sweep) lists `os.tmpdir()` and removes every entry starting with
  `bl1309-property-` - no owner pid, no age. A second instance of the file
  alive on the host (today: the coder@2 seat's lane, the master checkout's
  pre-commit guard lane twice, QA's lane, plus every role's solo re-run of a
  red file) deletes the first instance's live roots at its own module load.
  engineering.prompt already names this shape (BL-1385, BL-1390: "a blind
  prefix sweep destroys sibling runs"); BL-1287 made the pid rule law for
  fixture tunnels; BL-984's `sweepStaleFixtures` in
  `propertyLaneFixtureRunner.js` implements it for generated test files
  (pid in the name, `defaultIsPidAlive` with the zombie probe). Temp roots
  never got it.
- Census (main 2f3e112c2a): `grep -l 'readdirSync(os.tmpdir())'
  extension/test/*.property.test.js` -> 7 files (bl1030, bl1300, bl1309,
  bl1343, bl1356, bl1358, bl1359), none pid- or age-guarded; the unit lane
  has one (bl968StepRegistryMaterializedTreeGuard, BL-1620's file).
- The running lane (pid 11590, QA's BL-1611/BL-1613 verification) started
  12:54:26 local, after the specifier's solo run ended (12:53:02 + 29 s),
  so that run did not trip it. Until BL-1623 lands, a solo run of any of the
  seven while a lane is alive can.

## Disposition

- **Minted BL-1623** (`type: defect`, `severity: high` per the standing-red
  rule; `epic: code-quality-gates`), paused, `human_approval: pending`, no
  ruling posed: one helper `sweepStaleTmpDirs` in tmpDir.js, the seven
  files record their pid in the root name and sweep through it, a unit-lane
  guard pins the census. Three scenarios, two invariants (BL-1287's).
- **Register**: `backlog/standing-reds.tsv` gains one `property` row for
  bl1309 naming BL-1623 (first_seen 2026-09-17) and
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` the mirror
  row; both leave in BL-1623's land. The other six carry no row (no
  sighting yet).
- **BL-1620** notes gain bl968's sweep (its cut takes it).
- **QA resume note** (priority 00) sent the same pass: merge main first so
  the land keeps the rows (BL-1604's hazard), then land 73a520271b.
- **Coordinator** told the item is ready in `backlog/paused/`; expedited
  (Article 3.2.4); orthogonal to the active set (none touches the seven
  files or tmpDir.js).

## Found on the way: two closed-owner paths on the QA tip (BL-1546 refusal waiting for BL-1609/1611/1613)

An owner census of every path in `main..swarmforge-QA` (ba308c174e; 45
paths; owners from the leading id of the non-merge subjects touching each
path, the land step's own rule) finds two whose every owner is closed:

1. `swarmforge/scripts/land_step_cli.bb` - 8 lines from `eca9aaeb96`
   ("BL-1604: a land never carries another open ticket's registry-row
   removal"), coder@2's abandoned BL-1604 draft, riding the coder@2 ->
   cleaner -> architect -> hardender -> documenter -> QA chain with BL-1611.
   A `doseq` printing `REGISTER_ROW_RESTORED` lines from a plan key the
   landed record (06e6226cdb) does not produce - dead but untested draft
   code on a QA-exclusive path. BL-1604 is closed; the path differs from
   main; the BL-1546 clause refuses the land.
   Remedy (QA, holder, SWARMFORGE_ROLE=QA): `git checkout main --
   swarmforge/scripts/land_step_cli.bb` and commit on the QA branch with an
   UNTAGGED subject before the land; the merge-up broadcast then carries the
   restore to every branch that holds the draft lines. coder@2 told to do
   the same on its branch now.
2. `backlog/evidence/coder-at-2-seat-mailbox-undrainable-20260917.md` -
   committed on coder@2 as `349b336e71 evidence: coder@2 seat-mailbox
   undrainability and BL-1610 revert-hold rationale, 2026-09-17`: the
   subject names one id, BL-1610, so attribution credits BL-1610, now
   closed. Genuine, content-neutral evidence (BL-1615's notes cite it).
   Remedy (the aaed2cab79 shape): landed on main byte-identical in this
   commit (blob fb68c8b249); once QA merges main the path leaves the diff.

**Correction to the specifier's 2026-09-17 11:46Z ruling** (BL-1604 residue,
2f3e112c2a): that census ran `git diff --stat main swarmforge-coder@2 --
extension/test swarmforge/scripts/test specs` - test and spec paths only -
and so missed `land_step_cli.bb`. A residue census is `git diff --name-only
main <branch>` over EVERY path, each attributed by the subjects that touched
it, with any path whose owners are all closed flagged. The script used this
time is recorded in the mint commit's evidence for reuse.

By specifier.
