# mutation-stamp: sha256=366e730d0aaa465f54a89dd944c5e0f905041cb76fcc5403d69280f51b73318e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-11T00:37:39.147836793Z","feature_name":"BL-1478 A compiled-tool sweep that fails is logged, never silent","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1478-a-compiled-tool-sweep-never-fails-silently.feature","background_hash":"d9295ccf2c1e89134d51ecccbbcade41134f3324864af1560be60025a0014533","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a failing tool leaves one log line naming the sweep, the exit and its stderr","scenario_hash":"96ac9b81e9ef41a306880c04ac9f46f80b2581eab8419ded9a5745e26c6adf06","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-11T00:37:39.147836793Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1478 A compiled-tool sweep that fails is logged, never silent

  Four handoffd sweeps shell to a compiled node tool every cycle -
  resource-sample, context-telemetry-producer, turn-profile-producer and
  ritual-ledger-producer - and every one logs the tool's stdout only when it
  exits zero. A tool that exits non-zero, that the 60 s wait bound killed, or
  that never spawned leaves nothing in the daemon log but the sweep-boundary
  line, so a store can go dark for as long as nobody notices: the
  context-telemetry producer threw on every cycle from 2026-08-30 to at least
  2026-09-07 (BL-1477) and the log shows eight days of sub-second
  sweep-boundary lines and not one word why. This feature is that a failing
  compiled tool leaves one log line naming the sweep, the exit code and the
  first line of its stderr, and a succeeding one logs exactly as today.

  Background:
    Given a sweep that runs a compiled tool through the shared helper with its shell and log seams injected

  # BL-1478 a-compiled-tool-sweep-never-fails-silently-01
  Scenario Outline: a failing tool leaves one log line naming the sweep, the exit and its stderr
    Given the tool exits <exit> with stderr "<stderr>"
    When the sweep runs
    Then exactly one log line names the sweep, exit <exit> and "<stderr>"

    Examples:
      | exit | stderr                                |
      | 1    | SyntaxError: Unexpected token in JSON |
      | 124  | wait bound exceeded                   |
      | 127  | spawn failed: ENOENT                  |

  # BL-1478 a-compiled-tool-sweep-never-fails-silently-02
  Scenario: a succeeding tool logs its stdout as today
    Given the tool exits 0 with stdout "RECORDED 12 event(s) for 7 agent(s)"
    When the sweep runs
    Then the log carries the tool's stdout line and no failure line

  # BL-1478 a-compiled-tool-sweep-never-fails-silently-03
  Scenario: a multi-line stderr is cut to its first line
    Given the tool exits 1 with a stderr of 40 lines
    When the sweep runs
    Then the failure line carries only the first stderr line
