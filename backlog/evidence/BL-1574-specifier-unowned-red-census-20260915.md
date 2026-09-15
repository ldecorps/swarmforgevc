# BL-1574 - specifier census on the unowned-red notes of 2026-09-15

Two priority-00 notes named the same red: the coder's
`unowned-red: test_operator_runtime_tick.sh miniapp-watchdog bounce check`
(01:45Z) and QA's `unowned-red BL-1569 held: test_operator_runtime_tick.sh
miniapp red` (02:24Z; Article 4.2 hold on the BL-1569 parcel ca69008ee5,
evidence `backlog/evidence/BL-1569-QA-unowned-red-20260915.md` on the QA
branch at 071c2f73e1). The file had no row in `backlog/standing-reds.tsv`
and no open ticket named it.

## Reproduction on `main` 6d6e90ba7b (specifier, this pass)

`bash swarmforge/scripts/test/test_operator_runtime_tick.sh` - 1:00.77
wall, 48.9 s user; one check red of 160:

```
FAIL - miniapp-watchdog: down bridge triggers a bounce attempt
operator_runtime smoke: FAILURES
```

The section's second check, "watchdog state records a completed bounce
cycle", passes. The fixture's `.swarmforge/operator/runtime.log` (test
copy truncated after line 92 with the `rm -rf` replaced by a print):

```
2026-09-15T02:30:04Z miniapp-watchdog bounce-failed failures=1 exit=127 bash: <fixture>/swarmforge/scripts/recover_miniapp_bridge.sh: No such file or directory
```

## Mechanism and first red

- `make_fixture` copies `copy_operator_runtime_sandbox` (the bb load
  closure) plus `operator_telegram.bb`/`operator_telegram_lib.bb`. No shell
  script is copied; the watchdog section writes its own
  `bounce_bridge_headless.sh` stub.
- `operator_runtime.bb` `miniapp-bounce-bridge!` runs
  `recover-miniapp-bridge-script` since BL-1571's 442bdd1f40
  (2026-09-14 19:57, `git log -- swarmforge/scripts/operator_runtime.bb`).
  Before it the call went to `bounce-bridge-headless-script`, which the
  fixture stubs - the test was green. The test file itself last changed in
  309e11bdef (BL-653, 2026-08-26); QA's evidence attributes the red to
  that, but the trigger is the runtime reroute.
- `miniapp-watchdog-sweep!` writes `{:consecutive-failures 0
  :last-bounce-at-ms now}` on BOTH the `bounced` and the `bounce-failed`
  branch, so the second check is green on a bounce that exited 127.
  BL-1445's fail-open shape; BL-1574 tightens it.
- Root cause of the miss: BL-1571's mint (specifier, 2026-09-14) scoped the
  four bridge scripts and the bl1159 test as unchanged/green but did not
  grep the siblings that STUB `bounce_bridge_headless.sh` for assertions the
  reroute falsifies (BL-1006's successor-ticket obligation). The grep that
  would have found it: `grep -ln 'bounce_bridge_headless.sh'
  swarmforge/scripts/test/*.sh specs/pipeline/steps/*.js` - 8 files, of
  which only this one and the bl1159 test tick with the watchdog ENABLED.

## Census (BL-1445) - fixtures that enable the miniapp watchdog

```
grep -ln 'OPERATOR_MINIAPP_WATCHDOG_ENABLED=1' swarmforge/scripts/test/*.sh specs/pipeline/steps/*.js
```
2 files: `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh`
(green, copies the router itself) and `test_operator_runtime_tick.sh`
(red). Four more name the variable with `=0`/`'0'` (bl763 cursor-bridge
watchdog, babysitterd watchdog, gh26 and bl906 handlers) - the watchdog
never runs there. The invariant on BL-1574 pins this population.

## Register retirements in the same commit (memory rule: verify green, retire, never re-mint)

`standing_red_register_cli.bb` on `main` reported 16 rows, 5 UNOWNED:
rows naming tickets already in `backlog/done/`, left behind by lands that
did not remove them. Each test re-run on `main` 6d6e90ba7b this pass:

| row | ticket (closed) | run | result |
|---|---|---|---|
| bb `bl983_stage_queue_property_runner.bb` | BL-1559 | `bb ...runner.bb` | ALL PROPERTIES HOLD, 16 draws, two-seat 10 (floor 6), 2:25 wall |
| shell `test_operator_runtime_fixture_reaper_sweep_liveness_undetermined.sh` | BL-1570 | bash | ALL CHECKS PASSED, 1.1 s |
| shell `test_operator_runtime_sandbox_sweep_liveness_undetermined.sh` | BL-1570 | bash | ALL CHECKS PASSED, 2.2 s |
| shell `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh` | BL-1571 | bash | ALL CHECKS PASSED, 3.4 s |
| property `bl1429StandingRedThrottleFoldInvariants.property.test.js` | BL-1572 | `npx vitest run --config vitest.properties.config.mjs <file>` from `extension/` | 4 passed, reach map 12 combinations min 5 draws, 2.8 s |

After the edit: 12 rows, `unowned: []`, oldest 8 days.

## Gates on the mint
Recorded below the commit in the ticket's `notes:` are not repeated; the
gate outputs of this pass are in the specifier's turn log.
