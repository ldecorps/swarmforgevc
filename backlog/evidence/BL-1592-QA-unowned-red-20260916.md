# BL-1592 — QA unowned-red hold, 2026-09-16

`npm test` (unit lane) at parcel commit 5307ab9f56 (Merge documenter
3a1c318536 into QA) fails one test, unrelated to this ticket's four
property files or its own changed paths:

Failing command: `npm test` (from `extension/`)
Commit: 5307ab9f56

```
FAIL  test/telegramCursorOperatorExec.test.js > BL-1204: executeOperatorVerb(/redeploy, "frontdesk") dispatches to the front desk redeploy module
Error: ENOTEMPTY: directory not empty, rmdir '/tmp/bl1204-fd-blZG8d'
 ❯ sweepPendingTmpDirs test/helpers/tmpDir.js:76:8
 ❯ test/helpers/tmpDirSetup.js:11:3
```

Reproduced solo (`npx vitest run test/telegramCursorOperatorExec.test.js`,
same commit): same failure, same assertion, different tmp dir name
(`/tmp/bl1204-fd-mUaPx5`) — deterministic, not a one-off flake.

`grep -rl "sweepPendingTmpDirs\|rmdir.*ENOTEMPTY\|directory not empty"
backlog/paused backlog/active` — empty, no open ticket.
`grep -rl "telegramCursorOperatorExec\|ENOTEMPTY" backlog/` finds only
unrelated historical evidence files, none owning this failure.

`git log --oneline -- extension/test/telegramCursorOperatorExec.test.js
extension/test/helpers/tmpDir.js extension/test/helpers/tmpDirSetup.js`
shows the last touching commits predate this parcel entirely
(`c9edf9f01e fix(BL-1204): wire /redeploy frontdesk and /redeploy all to
their modules`, and unrelated BL-1263 retirements) — none of BL-1592's
own diff (the four property test files' third-argument wiring) touches
any of these three files.

Failure class: `unit`. Expected: green. Observed: `ENOTEMPTY` from
`sweepPendingTmpDirs`, a tmp-dir cleanup race in
`test/helpers/tmpDir.js:76`, unrelated to BL-1592's changed paths.

BL-1592's own scope (four property files' third-argument wiring,
register row removal) is otherwise clean: acceptance 14/14, the four
target property files 10/10 green solo, standing-red register
`"unowned":[]`. Holding only on this unrelated unit red per Article 4.2.

By QA.
