# Article 4.2 escalation on 4392593af6 (BL-1382 tip-pure land) — FALSE POSITIVE

Operator disposition, 2026-09-04T22:26Z (UTC). 15th instance of the documented
standing class: the Article 4.2 / BL-247 pipeline-code-on-main predicate is
**ancestry-only**, so every QA hand-built tip-pure land flags, by construction.

## Escalation as delivered
`pipeline code landed on main outside QA (Article 4.2/BL-247):`
`4392593af69bbfb2a6a5485d650c06bf3c084a9f "BL-1382: tip-pure land -- own paths`
`only, replayed onto origin/main"` — flagged paths
`extension/test/bl1382CronOwnershipMarkerOnly.property.test.js`,
`specs/pipeline/steps/bl1382UnmarkedCronLineSurvivesSteps.js`.

## Verified, not assumed
- `is_qa_ancestor.sh 4392593af6` → **rc=1**, read from `$?` directly (not through
  a pipe — the tail-masks-rc trap).
- **Bounce arm ruled out**: no `4392593af6` record under `.swarmforge/bounces/`
  and none in `backlog/**` `bounce_history`. The "no" is therefore *purely*
  ancestry: `git merge-base --is-ancestor 4392593af6 swarmforge-QA` → NOT an
  ancestor, exactly as the BL-1376 hand-built tip-pure route guarantees.
- **Decisive content check** — the flagged code on `main` IS what QA holds.
  Blob-identical across `main` == `swarmforge-QA` == `origin/main`:
  - `extension/test/bl1382CronOwnershipMarkerOnly.property.test.js` 5a310fb2ce
  - `specs/pipeline/steps/bl1382UnmarkedCronLineSurvivesSteps.js` bf135fab6c
  - `swarmforge/scripts/swarmforge_cron_lib.sh` 01c56004f5
  - `swarmforge/scripts/reconcile_shift_schedule_crontab.bb` b088ed4519
  Only *ancestry* differs.
- Single parent `de350f001f`; no `MERGE_HEAD` (checked via
  `$(git rev-parse --git-dir)`, not `.git/` — the linked-worktree file lie);
  `origin/main...main` = 0/0.
- Commit is stamped **"By QA."** with `abandoned_commits: [398274db07]` and
  cites the human ruling (marker-only ownership, option 1, SUP-17). Five
  BL-1382 role evidence files (architect/cleaner/coder/documenter/hardener)
  are present in the same commit.
- QA's own pane reports it: *"BL-1382 (crontab marker-only ownership,
  human-ruled) — approved and landed … hand-built tip-pure per that route,
  each verified against origin/main before push."*
- Ticket is **closed**: `backlog/done/M8/BL-1382-a-crontab-line-the-swarm-did-not-write-is-never-the-swarms-to-remove.yaml` (commit `62db12ccd6`).

## Action taken
**None.** No revert, no new ticket, no nudge, no NOTIFY, no ASK. See the
standing memory articles `article42-predicate-is-ancestry-only-qa-handland-always-flags`
and `babysitter-article42-expedite-lane-land-is-a-standing-false-positive`.

---

## Re-delivery, 2026-09-04T22:55Z (UTC) — same sha, same verdict

The Article 4.2 escalation for `4392593af6` was delivered a **second** time.
No new information; the commit is immutable and already closed. Only the cheap
arms were re-run rather than reprinting the whole analysis:

- `is_qa_ancestor.sh 4392593af6` → **rc=1**, read directly from `$?` (not piped —
  the tail-masks-rc trap).
- Bounce arm re-checked: no `4392593af6` under `.swarmforge/bounces/` — the "no"
  is still **purely** the ancestry arm the BL-1376 hand-built tip-pure route
  guarantees by construction.
- Both flagged blobs re-compared `main` vs `swarmforge-QA` — still IDENTICAL
  (`5a310fb2ce` / `bf135fab6c`). The code on `main` IS what QA holds; only
  ancestry differs.

20th instance of the documented ancestry-only class overall, 2nd delivery of
this one. **No action taken** — no revert, no ticket, no nudge, no NOTIFY,
no ASK. Appended here rather than written as a new file so the class count is
not inflated by a duplicate.

---

## Re-delivery, 2026-09-04T23:25Z (UTC) — same sha, third delivery, same verdict

`4392593af6` was escalated a **third** time. A commit object is immutable and the
ticket is closed, so nothing above can have changed. Only the two cheap arms were
re-run; the 4-blob identity table from the 22:26Z pass was NOT re-derived.

- `is_qa_ancestor.sh 4392593af6` → **rc=1**, read directly from `$?` with output
  redirected to a file (not piped — the tail-masks-rc trap).
- Bounce arm still **empty**: 0 hits for `4392593af6` under `.swarmforge/bounces/`,
  so the "no" remains *purely* the ancestry arm the BL-1376 hand-built tip-pure
  route guarantees by construction.
- Both flagged blobs re-compared `main` vs `swarmforge-QA` — still **identical**
  (`5a310fb2ce` / `bf135fab6c`). The code on `main` IS what QA holds.

**No action taken** — no revert, no ticket, no nudge, no NOTIFY, no ASK. Note that
the coordinator, at 23:20Z, independently dismissed this same batch as duplicates
and raised the sweep-level dedup gap itself; that is its call to mint, not mine.
Appended here rather than as a new file so the class count is not inflated.

## Re-delivery, 2026-09-04T23:57Z (UTC) — same sha, fourth delivery, same verdict

Commit objects are immutable and the ticket is closed, so nothing above was
re-derived. Cheap arms only: `is_qa_ancestor.sh 4392593af6` → **rc=1** (read from
`$?`, output redirected to a file — not piped, the tail-masks-rc trap); bounce arm
still **empty** (0 hits under `.swarmforge/bounces/`), so the "no" remains purely
the ancestry arm the BL-1376 hand-built tip-pure route guarantees; both flagged
blobs still identical `main` == `swarmforge-QA` (`5a310fb2ce` / `bf135fab6c`).
**No action taken.** The sweep-level dedup gap stays the coordinator's to mint.
