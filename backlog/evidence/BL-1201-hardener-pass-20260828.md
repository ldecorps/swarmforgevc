# BL-1201 hardener pass — 2026-08-28

Merged architect handoff `1adad4a401` (2nd architect pass, clean —
`deliverRoleAnswer` re-fix independently re-reproduced). No conflicts.

## Architect's flagged gap, closed

Architect explicitly flagged (not a bounce item, Article 4.1.3's coverage
gate is mine): the new `deliver-role-answer.ts` CLI wrapper
(`parseArgs`/`main`) had zero direct test coverage — only the underlying
`deliverRoleAnswer` function was tested
(`bl1201DeliverRoleAnswer.test.js`).

Added `extension/test/deliverRoleAnswerCli.test.js`, mirroring
`recordBounceCli.test.js`'s in-process argv/cwd/stdout-stub pattern (never
a subprocess — drives the real `main()` in-process so mutation/coverage
tooling can see it, per the CLI main() thin-wrapper rule):

- `parseArgs`: valid `--role`, absent `--role`, `--role` with no value,
  empty `--role` value.
- `main()` with no `--role`: usage to stderr, non-zero exit, stdout
  untouched.
- `main()` end-to-end through the REAL `resolveCliMainWorktreeContext()` →
  `deliverRoleAnswer()` → `printJsonToStdout()` wiring, three cases:
  delivered (matching pending question), mismatch (pending question
  changed after capture), no-answer.

**Own mistake caught before it shipped**: my first draft of the
"delivered" and "mismatch" cases wrote the awaiting-question fixture as
`{ askedAtMs: N }` (camelCase) — the CLI test failed with `mismatch`
where I expected `delivered`. Traced it: the awaiting file
(`role-awaiting/<role>.json`) is written by Babashka's `role_ask.bb` and
uses `asked_at_ms` (snake_case); only the TypeScript-written *answer*
file uses camelCase `askedAtMs`. `readRoleAwaitingAskedAtMs` reads
`asked_at_ms` specifically. Fixed by matching
`bl1201DeliverRoleAnswer.test.js`'s own `writeAwaiting` fixture shape
(which already gets this right). Recording this because it is an easy
trap for any future fixture on this same file pair — two deliberately
different casings across a Babashka/TypeScript boundary, correlated by
value, not by field-name symmetry.

## Non-vacuity, hand-verified

Flipped `parseArgs`'s `if (!role)` guard to `if (false)` in the compiled
JS. 4 of 8 tests failed as expected (every case that depends on the
usage-guard actually firing). Restored; recompiled from source; 8/8 pass.

## Stryker — blocked twice, by two DIFFERENT pre-existing standing reds

Attempted a scoped run (`--mutate out/tools/deliver-role-answer.js`).
Blocked on the full-suite dry run both times:

1. With no workaround: `startBridgeHeadlessCli.test.js` fails for a
   missing `CURSOR_API_KEY` (this session's BL-1208 pass already traced
   this to BL-720, ticketed, "do not re-file").
2. With a fake `CURSOR_API_KEY` set to get past that: `liveRepoDerivationGuard.test.js`'s
   `BL-1038` scan fails on `docsStructureRealTree.test.js` and
   `pilotMkdtempConventionCheck.test.js` — the exact standing reds already
   covered by **BL-1209**/**BL-1212** (todo, paused; confirmed by grep,
   same disposition this session already established for the BL-1208 and
   BL-1204 passes).

Neither blocker is caused by, or related to, any BL-1201 file. Falling
back to hand-verified mutation (above) plus CRAP/coverage, matching the
BL-638 fallback discipline for an environmentally-unreachable but
otherwise-configured tool.

## Verification

- `npm run compile`: clean.
- `vitest run test/deliverRoleAnswerCli.test.js test/bl1201DeliverRoleAnswer.test.js
  test/telegramFrontDeskBotCore.test.js test/telegramFrontDeskBotCli.test.js`:
  732/732 pass.
- `run_acceptance.sh` on the BL-1201 feature, 3 consecutive runs: 3/3
  pass every run.
- CRAP scoped to the touched/flagged functions: `deliver-role-answer.ts`
  is 100% covered end to end (`parseArgs` CRAP 3.00, `main`'s inner
  arrow at CRAP 1.00). `deliverRoleAnswer` (CRAP 6.00, at threshold),
  `writeRoleAnswerFile` (5.00), `readRoleAwaitingAskedAtMs` (2.00),
  `captureRoleAnswer` (2.00) all 100% covered, no new debt.
- DRY (`jscpd`) on `deliver-role-answer.ts`: 0 clones.
- Standing whole-tree guards (parcel added a new
  `extension/test/*.test.js` file and a `specs/pipeline/steps/*.js` file):
  same 4 pre-existing failures as every prior pass this session, none
  naming any BL-1201 file.

## Cleanup

No orphaned `node --test`/`stryker` processes at handoff. Restored the
one hand-mutated compiled file from a `.bak` copy before recompiling from
source; no leftover scratch files.

By hardener.
