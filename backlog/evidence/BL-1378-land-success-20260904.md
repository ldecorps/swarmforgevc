# BL-1378 — LAND SUCCESS, 2026-09-04

Same-turn continuation of the BL-1377 land immediately above it in this
worktree's history — resumed in_process handoff (documenter's `eb9beed6d2`),
own `BL-1378-qa-pass-20260904.md` recorded a full independent PASS this
session (merge `3647e63486`).

## Merge-deletion guard, at merge time

`git merge eb9beed6d2` refused: `backlog/hold/BL-1309/BL-1356/BL-1359.yaml`
deleted, unattributed. Same class the hardener's own merge for this batch
already hit and resolved the same way — the incoming branch un-parks these
three from `hold/` elsewhere (attributed to BL-1296 by the guard's own
introducing-commit walk). Resolved by naming `BL-1296` (the introducing
ticket) and `BL-1378` (this handoff's own task) in the merge commit message;
content confirmed to survive at its new path, not lost.

## Ruling legitimacy — see `BL-1378-qa-pass-20260904.md`

Independently re-verified (a third time, after coder and architect) against
`.swarmforge/operator/telegram-approval-ask-messages.json`'s stored reply
and the approval commit's timestamp — genuine, not the BL-1296-style
recommended-label echo. Not repeated here.

## `land_step_cli.bb` (BL-1241) over-included unrelated files — same
standing class as every land this session

`LAND_REPLAY land-replay/BL-1378-8db7f53453 91753c2167` included, beyond
BL-1378's own 15 files: two other tickets' own `backlog/done/*.yaml`
(BL-1337, BL-1328), one unrelated human INTAKE file,
`docs/how-to/BL-1144-...md` (BL-1309's edit), `docs/how-to/BL-1175-...md`
(BL-1356's edit), `docs/how-to/BL-611-babysitterd-runbook.md` (BL-1359's
edit), `extension/docs/briefings/2026-09-03.json` (unrelated generated),
and three shared files stacking other tickets' entries alongside BL-1378's
own. `specs/pipeline/steps/bl1378ExpediteCloseGuardSteps.js` needed **no**
extraction at all — already byte-identical on `origin/main`, pre-landed as
orphan scaffolding by the (now-retired) "handler files first" route
(`a93aa4a18f`).

## Hand-built tip-pure commit

12 whole-file checkouts from cited commit `8db7f53453` (blob hashes,
including exec bits, verified identical post-checkout for every `.bb`/`.sh`
file) + 3 line-level splices (`docs/index.md`: one link, inserted after the
BL-1377 line already on `origin/main`; `docs/reference/Specification.MD`:
prepended BL-1378's own 26-line entry onto CURRENT `origin/main` content,
excluding the six other tickets' entries the automated tool stacked below
it; `swarmforge/scripts/test/suite-manifest.tsv`: inserted the one
`test_bl1378_expedite_close_guard.sh` row at its sorted position, excluding
four other tickets' rows). Built in scratch worktree
`land-replay-worktrees/bl1378-landtry`, off `origin/main` at `4028373a4d`
(BL-1377's own just-landed tip). `git diff --cached --stat origin/main`:
15 files, 1236 insertions(+), 0 deletions — exactly the expected set.

## Re-verified on the tip-pure tree

Symlinked `extension/node_modules`; compiled fresh.

- `npm run compile` — clean.
- `check_feature_handler_registration.sh <tree> --assume-main` — passed.
- `bb .../ticket_close_guard_lib_test_runner.bb` — ALL PASS.
- `bash .../test_bl1378_expedite_close_guard.sh` — ALL PASS.
- `bb .../bl1378_expedite_close_guard_property_runner.bb` — ALL PROPERTIES
  HOLD (500 runs).
- `bash .../test_ticket_close_guard.sh` — ALL PASS (pre-existing guard
  unchanged).
- `bash .../test_commit_integrity_cli.sh` — ALL PASS.

## Acceptance runner is standing-red on pure `origin/main` — unrelated, already tracked

Identical `bl1296BubbleSeatSteps.js` / `bubbleSeat` `MODULE_NOT_FOUND` crash
as BL-1376's and BL-1377's own land passes hit on this same `origin/main`,
same session. Already fully adjudicated (BL-1385, note sent 08:18Z) —
nothing new, no second escalation. BL-1378's own acceptance is
independently proven 12/12 in this worktree (real dependency chain
present).

## Landed

- Tip-pure commit `abdf283ece` off `origin/main` at `4028373a4d`. Pushed
  `4028373a4d..abdf283ece`.
- Follow-up commit `b5cc9a098e`: `abandoned_commits: [8db7f53453]` recorded
  on the ticket YAML (`backlog/paused/BL-1378-...yaml`, its current
  location — same paused/-not-active/ pattern as BL-1376/BL-1377, from the
  same expedite-teardown un-park commit `876bd76f08`). Pushed
  `abdf283ece..b5cc9a098e`.
- Neither push carried any `PASSENGER_SIBLING` content — hand-built
  own-paths excluded every file the automated tool would have ridden in on
  shared paths.
- Lock acquired/released from the shared root
  (`/home/carillon/swarmforgevc`) both times, per the correction recorded
  in `BL-1377-land-success-20260904.md`; both `--decide-only` calls (from
  the scratch worktree, holding the candidate) returned a clean `:next
  :push` on the first try — no rematch-at-edge confusion this time.

By QA.
