# BL-1964 QA hold on an unowned red (2026-10-06)

parcel_commit: 9847fb86de
red: extension/test/tmuxReaperGuard.test.js

The parcel's own third-pass review is clean (approval withheld only for the red below, Article 4.2):
- prior D1/D2 (`BL-1964-QA-20261006.md`) fixed: the dormant-cleaner step asserts the real wake-session returns the resident; scenario 2 stands a real coordinator tmux session on the fixture-owned socket and resolves through wake-session; the orphan handler is deleted. Fixture via mkSocketFixtureRoot + track(root) (reaper kills the fixture socket's server, refuses live sockets).
- qa-gather at 9847fb86de: sibling VERIFY; register/wiring/properties/acceptance exit 0; BL-1964 acceptance pass 2 fail 0; `bb swarmforge/scripts/test/handoff_wake_session_test_runner.bb` ALL TESTS PASSED; no fixture tmux server left running.

## The red (unit lane, `npm test`, one run)

Not caused by this parcel: the offender is `specs/pipeline/steps/bl571SequentialRotationDormantParitySteps.js`, last changed by main's hotfix c15a0f21aa (2026-10-06 00:32, "two unowned reds the bl812 sweep found - BL-571 scenario 03 ..."); the file is identical on origin/main. No row in backlog/standing-reds.tsv names tmuxReaperGuard; BL-2018 (that hotfix's stamp-off, paused) does not mention it. register_join: `{"file":"extension/test/tmuxReaperGuard.test.js","join":"absent"}`.

Verbatim:

```
 FAIL  test/tmuxReaperGuard.test.js > the real specs/pipeline/steps tree has zero tmux-reaper violations
AssertionError: expected zero tmux-reaper violations under specs/pipeline/steps, found:
/home/carillon/swarmforgevc/.worktrees/QA/specs/pipeline/steps/bl571SequentialRotationDormantParitySteps.js: can cause a tmux server to run but does not require ./lib/fixtureReaper and call track()
```

Resume: once an owner exists (or the hotfix adds `require('./lib/fixtureReaper')` + `track()` to the bl571 handler), re-run the gate on 9847fb86de against the register as it then stands, approve and queue the land, then `qa_hold_cli.bb close --task BL-1964 --outcome approved`.
