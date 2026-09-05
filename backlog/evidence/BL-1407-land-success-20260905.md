# BL-1407 land — 2026-09-05

BL-1407 APPROVED and landed (see `BL-1407-qa-pass-20260905.md` for the QA
verification record).

## Land sequence

1. First attempt (cited commit `d27012d0067404047c48b42060fb364d84997f2f`):
   `LAND_ESCALATE — land-step: could not read backlog/paused/BL-1425-a-queue-jump-places-the-ticket-past-the-depth-cap.yaml's attribution`.
   Cause: a timing race, not a structural class issue — BL-1425 was minted
   and approved on `origin/main` (commits `5ccb0c5226`/`0c547d98e9`) while
   the first attribution walk was running; the QA worktree was 8 commits
   behind `origin/main` at the time the walk read that path. Confirmed via
   `git fetch` + `git rev-list --left-right --count HEAD...origin/main`
   (1812/8) immediately after the escalation.
2. Rematch (BL-1144 discipline, bounded to one attempt): merged
   `origin/main` into the QA worktree (bringing in BL-1423/1424/1425 and a
   workflow-article amendment), giving cited commit
   `c334385d4f27fbb0264d1b0c5c3153324b4ff11e`.
3. Retry: `bash swarmforge/scripts/land_main_publish.sh . --land
   BL-1407-property-gate-reruns-a-red-in-isolation c334385d4f27fbb0264d1b0c5c3153324b4ff11e`
   → `LAND_REPLAY land-replay/BL-1407-c334385d4f 984a9a197bbbd267223962ea4677aa65aa395548`,
   pushed clean: `0c547d98e9..984a9a197b main`.

**Landed commit: `984a9a197bbbd267223962ea4677aa65aa395548`** (tip-pure
replay onto `origin/main`, BL-1241 land-step remedy). `abandoned_commits:
[c334385d4f27fbb0264d1b0c5c3153324b4ff11e]` recorded on the ticket per
that rule — the cited commit is not on `main`'s history, the replay is.

Reviewed the replayed tip before treating the land as done: 23 files
changed (1418 insertions, 17 deletions) — BL-1407's own core diff
(`check_property_suite_drift.sh`, its shell test, the `.bb` property
runner, the step handler, `docs/how-to/BL-570-...md`, `docs/index.md`,
and BL-1407's own coder/architect/documenter/qa evidence files) plus a
small number of PASSENGER_SIBLING one-line/small changes on shared paths
(see below) that `land_step_cli.bb`'s own passenger check (BL-1375)
allowed to ride along. Nothing destructive or out of proportion to
BL-1407's own scope.

## ENTANGLED_SIBLING (unlanded, per the tool's own attribution walk — named per QA.prompt's BL-1241 rule, not investigated further here)

BL-1296, BL-1309, BL-1317, BL-1328, BL-1337, BL-1342, BL-1344, BL-1345,
BL-1346, BL-1351, BL-1353, BL-1354, BL-1356, BL-1358, BL-1359, BL-1360,
BL-1361, BL-1362, BL-1363, BL-1364, BL-1365, BL-1366, BL-1367, BL-1369,
BL-1371, BL-1374, BL-1375, BL-1376, BL-1377, BL-1378, BL-1379, BL-1380,
BL-1381, BL-1382, BL-1383, BL-1384, BL-1385, BL-1386, BL-1388, BL-1389,
BL-1390, BL-1391, BL-1392, BL-1393, BL-1395, BL-1398, BL-1399, BL-1402,
BL-1403, BL-1404, BL-1408, BL-1409, BL-1410, BL-1411, BL-1412, BL-1413,
BL-1415, BL-1416, BL-1420, BL-1421, BL-848.

Several of these (e.g. BL-1296, BL-1309) were previously recorded
elsewhere as landed on other dates — their appearance here means the QA
worktree branch still carries an ancestor commit for them that the
attribution walk could not confirm as present on the CURRENT
`origin/main` tip at land time. Not re-investigated per-ticket here;
surfacing the raw list is the point (a silent rebuild would lose this
signal — QA.prompt).

## LANDED_SIBLING (confirmed already on origin/main — informational only, per BL-1272)

BL-1056, BL-1235, BL-1271, BL-1275, BL-1306, BL-1320, BL-1323, BL-1327,
BL-1332, BL-1333, BL-1335, BL-1336, BL-1339, BL-1340, BL-1341, BL-1343,
BL-1350, BL-1352, BL-1368, BL-1370, BL-1387, BL-1400, BL-1401.

## PASSENGER_SIBLING (content rode along in the replay, passed BL-1375's check)

BL-1364, BL-1365, BL-1380, BL-1383, BL-1389, BL-1390, BL-1391, BL-1392,
BL-1402.

## Coordinator action

Bookkeeping only: move BL-1407 `backlog/active/` → `backlog/done/`,
recheck `active_backlog_max_depth`, route the next item. The 60+
ENTANGLED_SIBLING tickets above are unlanded work still sitting in the QA
worktree branch's history — worth the coordinator's/specifier's attention
as a standing-backlog signal, not something BL-1407 itself needs to
resolve.

By QA.
