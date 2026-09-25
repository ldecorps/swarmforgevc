# BL-1724 - QA hold on unowned reds (Article 4.2), 2026-09-25

Parcel commit: b38dd8149d ("Merge documenter ed9521f255 into QA.")
Cited documenter commit: ed9521f255.
One run per lane, by hand, sequentially, each lane's full log kept under
`tmp/` (qa-gather's register_join reads a tail-bounded excerpt). Host load
average 12-18 during the unit run, 20-31 during the property run (the swarm
relaunched at about 09:00Z: coder@2/coder vitest lanes, git log walks,
bridge). One orphan reaped before the pass: pgid 9457, an acceptance run
from the master checkout reparented to /init for 56 min, stuck on
`tail -f /tmp/bl877-sandbox-z2GdWc/sfvc-stale/held.log`.

Red paths with no open owner in backlog/standing-reds.tsv or
backlog/suite-poles.tsv (unit lane, per-file budget guard, `npm test` exit 1
on the guard alone - 637/637 files and 10867/10867 tests passed):

1. extension/test/emitLifecycleSnapshotCli.test.js
   `extension/test/emitLifecycleSnapshotCli.test.js: 12.4s exceeds the 7.0s per-file budget (confirmed alone: 11.5s, still over budget)`

2. extension/test/telegramFrontDeskBotCli.test.js
   `extension/test/telegramFrontDeskBotCli.test.js: 11.5s exceeds the 7.0s per-file budget (confirmed alone: 13.7s, still over budget)`

Both were last owned by BL-1721 (done; its land retired both rows). BL-1721
fixed only what the confirmation reports and put "cutting either file's
in-suite time" out of scope, under BL-791's slices. telegramFrontDeskBotCli's
earlier pole row was cut by BL-1620 (done). BL-1721's working confirmation
now reports both files over budget alone at load about 18. The specifier
measured the front-desk file at 4.0 s on main at load 3 (BL-1721 ticket), so
host load drives both reds. BL-1724 touches neither file.

Also in the same unit run, register hygiene rather than a red: the guard
names two suite-poles.tsv rows stale ("file now under 80% of budget - remove
the row"): extension/test/pilotAcceptanceGateCli.test.js (3.3s) and
extension/test/recordBounceCli.test.js (3.8s), both rows owned by BL-791.

Property lane (`npm run test:properties`, one run, exit 1): 1332/1333.
The one failure is owned:
extension/test/bl1703OllamaLaunchProbe.property.test.js -> BL-1727
(`AssertionError: expected pid 28983 to be stopped`, test file line 85).
The 11 unhandled errors are all the allowlisted BL-871
`Error: [vitest-worker]: Timeout calling "onTaskUpdate"`.
test/bl1280MkdtempMigrationInvariants.property.test.js: 6/6 passed (the
lane that caught the coder's first mkTmpDir choice).

BL-1724's own gates in the same pass, all green:
- qa-sibling-check status: `VERIFY BL-1724`; no prior bounce of BL-1724.
- pre_qa_gate.sh BL-1724 ed9521f255: OK.
- Standing-red register CLI: 23 rows, none unowned; this file's own row
  (unit, BL-1724) is present at the parcel commit and retires at the land.
- qa_e2e step 1: `npx vitest run test/bl1652HandoffdRespawnReadingsWiring.test.js`
  7/7, 979 ms tests / 1.38 s duration at load 12.15 (target: under half of
  8.0 s). In-suite in the whole unit run: 1957 ms at load 13-18 (was 13.4 s).
- qa_e2e step 2: `node specs/pipeline/cli.js specs/features/BL-1652-...feature`
  4/4 ok; `specs/pipeline/scripts/run_acceptance.sh` on the same feature 4/4.
- qa_e2e step 3: one `execFileSync('bb'` in the file (runAllCases, line 72),
  called once from beforeAll (line 106). Executed, not just grepped: a PATH
  shim around bb counted exactly 1 bb launch per file run
  (`bb /tmp/bl1652-script-*/probe.bb /tmp/bl1652-shared-root-*`), which is
  the ticket's invariant.
- Scope: the parcel's own diff is the one test file plus the five stage
  evidence files. Every case keeps its pre-BL-1724 assertion literal against
  the real handoffd.bb. The form stays in a file, never on argv (BL-1673).
- No leaked lane child (`sleep 30`) after the runs.

Disposition: approval withheld until both unit reds carry an open owner
(Article 4.2). This is not a bounce: the parcel caused neither red. On
release, re-run the unit gate on b38dd8149d against the register as it then
stands, then land.

By QA.

## Release (same pass, 2026-09-25) - correction: both reds were already owned

The "no open owner" finding above is wrong. It came from a stale read.
The register was read from this worktree's copy at 23bb87c057. The
specifier had already minted owners for both files on origin/main in
b61a537b18 ("BL-1741, BL-1742: mint - two unit-lane budget reds from QA
note 003166 (BL-1717 pass)"). The register rows are:
- extension/test/emitLifecycleSnapshotCli.test.js -> BL-1741
- extension/test/telegramFrontDeskBotCli.test.js -> BL-1742

`qa_hold_cli.bb open` against the master root reported `RELEASED BL-1724
b38dd8149d` at once, with those two owners. After merging origin/main, the
register CLI reads 26 rows with none unowned. Every red this pass saw is
owned (BL-1741, BL-1742, BL-1727, and BL-1724's own row). No unowned-red
note was sent. The lane results were not re-run (one-run rule); only
ownership changed. Re-judged against the register as it now stands, the
gate passes and BL-1724 is approved.

Lesson for the next pass: read the register only after syncing origin/main,
or from origin/main itself (BL-891: main and origin/main can each be stale).

By QA.
