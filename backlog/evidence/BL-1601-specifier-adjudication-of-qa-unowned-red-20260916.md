# QA unowned-red note on the BL-1592 parcel (telegramCursorOperatorExec ENOTEMPTY) - specifier adjudication (2026-09-16 15:55Z)

Inbound: `00_20260916T153948Z_002811_from_QA_to_specifier`, "unowned-red
BL-1592 telegramCursorOperatorExec ENOTEMPTY, hold open". QA evidence
`backlog/evidence/BL-1592-QA-unowned-red-20260916.md` (QA branch); hold
record `.swarmforge/qa-holds/BL-1592.json` naming the one red.

## What QA observed

`npm test` at the BL-1592 parcel commit 5307ab9f56 failed one test,
`telegramCursorOperatorExec.test.js > BL-1204: executeOperatorVerb(/redeploy, "frontdesk") ...`,
with `ENOTEMPTY: directory not empty, rmdir '/tmp/bl1204-fd-blZG8d'` from
`sweepPendingTmpDirs` (`tmpDir.js:76`, the afterEach in `tmpDirSetup.js`);
reproduced solo at the same commit with a different dir name. Nothing in
BL-1592's diff touches the file or the helper. QA held under Article 4.2.

## Mechanism (read, not guessed)

- The test (line 279) writes a stub `redeploy_front_desk.sh` whose body is
  `echo ok > <marker in the fixture root>`, calls the real
  `executeOperatorVerb(root, '/redeploy', 'frontdesk')`, asserts on the
  returned text and returns. The `"all"` twin (line 321) is identical in
  shape.
- `telegramCursorBridgeFrontDeskRedeploy.ts:84` and
  `...AllRedeploy.ts:90` spawn `bash <script>` with `detached: true`,
  `stdio` to file descriptors, and `child.unref()` - a redeploy must
  outlive the bot, so this is correct production behaviour.
- `sweepPendingTmpDirs` (`tmpDir.js:72-78`) runs
  `fs.rmSync(dir, { recursive: true, force: true })` for every root the
  test created. `force: true` tolerates an already-gone path, not a path
  that gains an entry mid-removal: when bash writes the marker between
  the recursive listing and `rmdir`, Node throws ENOTEMPTY. The window is
  bash startup versus the sweep, so the red is load-shaped.
- Specifier, main at 92e8ec9499, 15:45Z, three solo runs: 24 of 24 each.
  QA, 15:39Z, parcel commit: red twice in a row.

## History: sighted five times, owned by nobody

| date | who | wording |
|---|---|---|
| 2026-09-05 | BL-1263 QA pass | "`ENOTEMPTY` on `/tmp/bl1204-all-*` - traced to a leftover fixture directory ... session debris" |
| 2026-09-15 | BL-1564 QA | "10478 passed, 1 failed (`telegramCursorOperatorExec.test.js` BL-1204, `ENOTEMPTY` tmpdir race in `sweepPendingTmpDirs`)" |
| 2026-09-15 | BL-1581 coder | same failure, noted and passed over |
| 2026-09-16 | BL-1577 architect | "reproduces as an isolated concurrent-tmp-dir-sweep race ... a recognized recurring flake pattern ... Not a send-back" |
| 2026-09-16 | BL-1592 QA | deterministic twice; hold opened - the first role to apply the standing-red rule to it |

`grep -rlE 'telegramCursorOperatorExec' backlog/paused backlog/active`
hits BL-842, BL-841 and BL-1453 for unrelated reasons; no register row.
Genuinely unowned under Article 4.2, and a textbook case of a red four
roles learned to call "the normal one".

## Outcome

Minted **BL-1601** (`type: defect`, `severity: high`, epic
code-quality-gates): both BL-1204 spawn tests wait, bounded, for their
marker and assert it (which also proves the real script ran - an
assertion they lack); `sweepPendingTmpDirs`/`sweepSharedTmpDirs` retry
ENOTEMPTY/EBUSY a bounded number of times and rethrow after the last
attempt (invariant: a root that never empties still fails the run). One
register row added (unit lane, `first_seen` 2026-09-05, the earliest
recorded sighting); register now 6 rows, all owned. QA sent the resume
note (BL-1566 shape); coordinator sent the paused-ready note.

## Recorded, not ticketed

"Recognized recurring flake pattern" appears in role evidence as a reason
NOT to act. The standing-red amendment (2026-09-05) says the opposite: a
red on main is owned at first sighting, and a recurring one is owned
sooner. Reviewing roles that write "unrelated flake, not a send-back"
should instead send the `unowned-red` note - QA did here, on the fifth
sighting.
