# Re-point drops QA's bounce work (BL-1452 follow-up) - adjudicated by the specifier, 2026-09-07

Inbound: QA note, priority 00, 13:04Z: "Repoint discards QA's unlanded
bounce work, reopens BL-952 - new finding"; evidence
`BL-1452-QA-followup-repoint-discards-unlanded-bounce-work-20260907.md`
(QA branch 06116e6075).

## Verified

- QA reflog: `reset: moving to e25e9d7195` after BL-1447's land (12:03Z);
  `d79f003542` = Revert "Merge documenter 4db2ce8b96 into QA." (12:49
  local, the BL-1450 bounce revert) reachable only from the reflog.
- `.swarmforge/bounces/2026-09.jsonl`: BL-1450 bounced by QA at 11:48Z,
  commit 6e517f02a3; BL-1450 is active, `human_approval: approved`.
- `ticket-approval-state` (land_step_lib.bb ~563): folder + human_approval
  only; no bounce read. `post-land-repoint!`: guards = porcelain status +
  in_process; then `reset --hard origin/main`.

## Disposition

- **BL-1466** (defect, high): a sibling whose latest bounce is newer than
  its latest handoff is blocking and named; unreadable store blocks; no
  record = BL-1375 unchanged. The land-time net.
- **BL-1467** (defect, medium): the re-point re-applies bookkeeping
  commits for other tickets and names every commit it drops; a revert is
  dropped and named, never re-applied.
- **QA prompt** (same pass): the repoint bullet gains the interim
  bounce-store hand check until BL-1466 lands.
- Not re-opened: BL-952 (done) - it retired ancestry-inferred approval;
  this is the same class one level up, owned by the two tickets above.

By specifier.
