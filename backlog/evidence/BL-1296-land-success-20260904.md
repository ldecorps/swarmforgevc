# BL-1296 — LAND SUCCESS, 2026-09-04

Third land this session/turn, resumed via specifier `note` (in_process at
session start): "BL-1296 approval stands. Blocker is BL-1371, not your
parcel. See evidence." Full re-verification and disposition reasoning in
`BL-1296-qa-relanding-20260904.md`, written before this land attempt.

## Blocker confirmed gone

`bb swarmforge/scripts/land_step_cli.bb BL-1296-bubble-answers-from-its-own-seat
359a2c8e66` (cited commit: this worktree's HEAD at the time, which already
contained BL-1296's full forward-pipeline history as an ancestor) returned
`LAND_REPLAY`, not `LAND_ESCALATE` — no `missing registry module` refusal
from `check_feature_handler_registration.sh` this time, confirming BL-1371's
directory-discovery registration (landed 2026-09-03 16:57 BST) removed the
shared-`index.js`-entanglement blocker the prior QA session hit and
escalated (`BL-1296-land-escalate-20260903.md`).

## Hand-built tip-pure commit — same standing over-inclusion class

Automated replay's 29-file diff against `origin/main` included, beyond
BL-1296's own 20 files: two other tickets' own `backlog/done/*.yaml`, one
unrelated INTAKE file, three other tickets' own `docs/how-to/*.md` edits
(BL-1144/BL-1309, BL-1175/BL-1356, BL-611/BL-1359), one unrelated generated
briefing file, and `docs/index.md`/`Specification.MD` stacking two other
tickets' (BL-1367, BL-1360) entries alongside BL-1296's own.
`specs/pipeline/steps/bl1296BubbleSeatSteps.js` needed no extraction — the
very file already on `origin/main` since `a93aa4a18f` (its ORPHAN status,
with no backing `bubbleSeat.ts`/`bubbleSeatLive.ts`, is exactly the gap
this land closes and BL-1385 now guards against structurally).

Own-paths: 9 pipeline evidence files + this session's own
`BL-1296-qa-relanding-20260904.md` + how-to page + ticket YAML (26-line
bookkeeping append, blob-verified against the cited commit) + 3 source
`.ts` files + 5 test files + feature-file stub-extension = 20 whole-file
checkouts, plus 2 line-level splices (`docs/index.md` one link;
`docs/reference/Specification.MD` one 26-line entry, excluding BL-1367's
and BL-1360's stacked below it in the automated diff). No
`suite-manifest.tsv` entry — this ticket's tests are `vitest`-lane, not the
`.bb`/shell standing-suite manifest. Built off `origin/main` at `b5cc9a098e`
(BL-1378's own just-landed tip). `git diff --cached --stat origin/main`:
23 files, 2247 insertions(+), 0 deletions — exactly the expected set;
every `.ts`/`.js`/feature/yaml file blob-verified byte-identical to the
cited commit before commit.

## Re-verified on the tip-pure tree

Symlinked `extension/node_modules`; compiled fresh against `origin/main`'s
own source.

- `npm run compile` — clean.
- `check_feature_handler_registration.sh <tree> --assume-main` — passed.
- `npx vitest run bubbleSeat.test.js bl1296BubbleSeatLive.test.js
  bl1296BubbleSeatTurn.test.js telegramCursorBridgeLive.test.js` —
  156/156 pass (4 files), including the pre-existing bridge suite unbroken.
- `npx vitest run --config vitest.properties.config.mjs
  bl1296BubbleSeatInvariants` — 5/5 pass.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1296-bubble-answers-from-its-own-seat.feature` — 6/6
  pass.

## Confirms the fix: an UNRELATED feature also runs clean on this tree

Control check: ran `run_acceptance.sh
specs/features/BL-1377-a-suites-failure-set-is-recorded-once-per-base-commit.feature`
on this SAME tip-pure tree (built off `origin/main`, BL-1296's own source
now present) — 10/10 pass, no `bl1296BubbleSeatSteps.js` module-load crash.
This is the standing acceptance-runner defect (`BL-1385` adjudication,
`BL-1296-orphan-handler-crashes-discovery-20260904.md`) that BL-1376's and
BL-1377's and BL-1378's own land passes all hit and deferred to this land —
confirmed genuinely fixed for every ticket's acceptance run on
`origin/main`, not just BL-1296's own, once this commit lands.

## Landed

- Tip-pure commit `60043c433f` off `origin/main` at `b5cc9a098e`. Pushed
  `b5cc9a098e..60043c433f`.
- Follow-up commit `a72336cd8f`: appended `359a2c8e66` to the ticket's
  EXISTING `abandoned_commits:` list (`[6077a6bfbc, fefcb7c13d]` →
  `[6077a6bfbc, fefcb7c13d, 359a2c8e66]`, a documenter-era list from an
  earlier BL-1241 rebuild on this same ticket — appended rather than
  overwritten). Pushed `60043c433f..a72336cd8f`.
- `task_scope_gate_cli.bb` returned `OK` on the tip-pure commit
  independently of the `abandoned_commits` edit.
- Neither push carried any `PASSENGER_SIBLING` content.
- Lock acquired/released from the shared root
  (`/home/carillon/swarmforgevc`); both `--decide-only` calls returned a
  clean `:next :push` on the first try.

By QA.
