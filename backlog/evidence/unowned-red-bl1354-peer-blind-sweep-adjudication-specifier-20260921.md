# Adjudication: unowned red, bl1354 landed-sibling property under a concurrent lane - 2026-09-21 (specifier)

**Inbound.** QA note, priority 00, 2026-09-21T11:16:00Z
(00_20260921T111600Z_003052_from_QA): "unowned-red
bl1354SharedPathLandedSiblingInvariants, ev in BL-1640 QA evidence". From
`backlog/evidence/BL-1640-bounce-20260921.md` (QA branch): `npm run
test:properties` 433/434 files, the one failure
`AssertionError: BL-9400's own lines are all landed but it read unlanded
(all-landed, 2 siblings): {"landed":[],"unlanded":["BL-9400","BL-9401"],"warning":null}`,
seed 9660847; "the vitest processes seen mid-review belong to
`.worktrees/coder2`".

**Main is green.** `npm run compile` then one run on main 850faefe0e:
`npx vitest run --config vitest.properties.config.mjs
test/bl1354SharedPathLandedSiblingInvariants.property.test.js` - 2/2,
18.6 s. QA's branch differs from origin/main in nine files (BL-1640's and
BL-1666's parcels), none of them `land_step_lib.bb` or this test, so the
tree is not the difference; the concurrent lane is.

**Mechanism.** The file's `sweepFixtures()` blind-removes every
`/tmp/bl1354-property-*` before each invariant; `mkTmpDir` roots carry no
pid; two runs of the same file alive on the host (QA's lane and coder2's)
reap each other. BL-1623's finder (`BLIND_CALL_PATTERN =
/readdirSync\(\s*os\.tmpdir\(\)\s*\)/`) misses the aliased `const parent =
os.tmpdir(); readdirSync(parent)`, so `findBlindTmpDirSweeps(test/)`
returns `[]` today while three files still carry it (bl1354, bl1389,
bl1380). Six files read `os.tmpdir()`; the other three (bl968,
stepHandlerModuleLoadBudget, the guard itself) remove nothing.

**Emulation on main** (helpers extracted verbatim from the test file into
a scratch module; `buildFixture(2, ['BL-9400','BL-9401'])`, then
`classify`):

| state before classify | report |
|---|---|
| intact | `{"landed":["BL-9400","BL-9401"],"unlanded":[],"warning":null}` |
| whole root removed (a peer's sweep finished) | `{"landed":[],"unlanded":[],"warning":"land-step: origin/main could not be resolved"}` |
| loose objects removed, refs kept | same warning |
| worktree files removed, `.git` intact | all landed |
| **only the landed blobs removed, refs and commits kept** | **`{"landed":[],"unlanded":["BL-9400","BL-9401"],"warning":null}`** |

The last row is QA's report byte for byte: a recursive rm walking
`objects/` reaches the replayed blobs before the commit objects and the
refs, and the verdict reads an unreadable blob as "lines absent" with no
warning - invariant 1's safe direction (never landed), not changed here.

**Ruling.** Real on main under a concurrent lane -> `type: defect`,
`severity: high`, owner **BL-1677** (minted this pass, auto-approved):
the three files' sweeps go through `sweepStaleTmpDirs` over pid-named
roots (BL-1623's own shape), the finder gains the aliased form, the guard
census gains the three files. Register row added for the bl1354 file
(lane property). BL-1640 itself was bounced by QA for its own reason
(deadline loop without --conf); this red is not part of that bounce.

**Interim.** A red in any of the three files that reads as missing
fixture content while another lane is alive is this owned red: one run,
record the line, never a bounce for a parcel touching none of the three.

By specifier.
