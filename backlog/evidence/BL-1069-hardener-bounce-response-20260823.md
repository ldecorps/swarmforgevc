# BL-1069 — hardener response to QA bounce

QA's bounce (`backlog/evidence/BL-1069-swarm-stamp-tmux-wsl-segfault-upgrade-hotfix-bounce-20260822.md`)
correctly identified 12/29 BL-113 Gherkin mutants surviving on scenario 1
("the version verdict is read from the server, not the client"), left
unfixed in the prior pass citing "session time constraints" — the same
invalid deferral QA rejected in this session's BL-1015 bounce.

## Root cause

The step handler pinned the `<verdict>`/`<chosen>` columns against declared
sets (`KNOWN_VERDICTS`, `KNOWN_CHOICES`) but never pinned the `<client>`/
`<server>`/`<local>`/`<path>` version VALUES themselves. Since the real
comparison logic (exercised as a genuine subprocess) only cares which SIDE
of the version threshold a value falls on, many mutated values (`3.4` ->
`2.06`, `3.7b` -> `3.7B`, `none` -> `value`) land on the same side as the
original and produce the identical verdict, so nothing caught the mutation.

## Fix

Added `KNOWN_VERSIONS = new Set(['3.4', '3.7b'])` (every real version
string either Scenario Outline's Examples table actually declares) plus an
`assertKnownVersion(value, label)` helper, wired into all four step
handlers that receive a raw version string (`client`, `server`, `local`,
`path`) — asserted before the real subprocess comparison ever runs, so any
mutation to the value itself is caught regardless of which side of the
comparison it happens to land on.

## Verification

- **Environmental gotcha found first**: the freshly-merged BL-713 batch
  item registered `bl713CursorSeatDriverSteps.js` in the shared step
  registry, but its compiled `out/swarm/cursorSeatDriver.js` did not exist
  yet in this worktree — every Gherkin mutation run (for BL-1069 or any
  other ticket) crashed on `MODULE_NOT_FOUND` at registry load, and every
  such crash counted as a false "kill" (BL-884's exact trap), silently
  poisoning the manifest with bogus all-green results. Fixed by compiling
  (`npm run compile`) before re-running; confirmed the registry loads
  clean afterward.
- **Stale/bogus manifest stamp**: even after compiling, a `soft` re-run
  skipped everything because the crash-poisoned manifest's stamp still
  matched the (unchanged) feature text. Forced a genuine re-test with
  `full` mode.
- **Before fix**: 29 total, 17 killed, **12 survived** — exact match to
  QA's bounce count.
- **After fix**: 29 total, **29 killed, 0 survived**, re-confirmed with a
  second independent `full` run.
- `specs/pipeline/scripts/run_acceptance.sh` on the BL-1069 feature: 12/12.
- `bash swarmforge/scripts/test/test_bl1069_tmux_server_version.sh`: ALL
  TESTS PASSED.
- `bb swarmforge/scripts/test/bl1069_tmux_version_property_runner.bb`: ALL
  40 RUNS PASSED, healthy diversity across all client/server value classes
  (unaffected by this pass — no production logic touched, only the
  acceptance step handler).
- Orphaned processes: none. `git status --short`: only the two files this
  pass touched.

## Verdict

The gap QA named is fixed, not merely re-measured: 12 real survivors killed
via a new value-pinning assertion, matching the exact pattern QA's own
bounce evidence pointed to (the BL-1029 sibling item's equivalence
handling, contrasted with this item's prior unmet gate). No deferral.

— By hardender.
