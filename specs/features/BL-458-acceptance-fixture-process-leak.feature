# mutation-stamp: sha256=96f15d2f41cfacfae750d0f53be247ba2c8d6da44bb4cc224532c828c93c3543
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T17:00:07.789762007Z","feature_name":"acceptance-test fixtures always reap the process trees they spawn, and orphans self-heal","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-458-acceptance-fixture-process-leak.feature","background_hash":"8b20915b0c85714b7125140316d4ed22fb4348f60503b5569ef0ff69c3eac59a","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the orphan reaper reaps a fixture root only when it is a known fixture, stale, and not the live swarm socket root","scenario_hash":"644c2c446ec6031fd4599e0d61b3430f79eaad76c2c251a1d7304d43b2bd736a","mutation_count":16,"result":{"Total":16,"Killed":16,"Survived":0,"Errors":0},"tested_at":"2026-07-16T17:00:02.730000766Z"}]}
# acceptance-mutation-manifest-end

Feature: acceptance-test fixtures always reap the process trees they spawn, and orphans self-heal

  # Acceptance step files under specs/pipeline/steps/ launch DETACHED process
  # trees (front_desk_supervisor.bb + node bridge + node bot via nohup, and
  # tmux servers via role_lifecycle) that reparent to init and outlive the
  # runner. Their only cleanup is inline teardown inside terminal Then steps, so
  # any assertion that throws first — or a SIGTERM/timeout/OOM-kill of the run —
  # leaks the whole tree permanently (four such mini-swarms survived ~18h and
  # ~1.45 GB after a Jul-15 interrupted run). Two required halves: PREVENTION
  # (teardown fires even on abnormal exit) and AUTO-CLEAN (a reaper kills stale
  # orphaned fixture trees a crashed run left behind). The reaper must never
  # signal the live swarm's own socket root — same guardrail as BL-413.

  Background:
    Given the acceptance-test fixture process reaper

  # BL-458 fixture-process-leak-01
  Scenario Outline: the orphan reaper reaps a fixture root only when it is a known fixture, stale, and not the live swarm socket root
    Given a /tmp entry whose name matches a known test-fixture prefix is "<prefix_match>"
    And its age past the stale threshold is "<is_stale>"
    And it being the live swarm socket root is "<is_socket_root>"
    When the reaper evaluates the entry
    Then the fixture process tree is killed and its root removed is "<reaped>"

    Examples:
      | prefix_match | is_stale | is_socket_root | reaped |
      | yes          | yes      | no             | yes    |
      | yes          | no       | no             | no     |
      | no           | yes      | no             | no     |
      | yes          | yes      | yes            | no     |

  # BL-458 fixture-process-leak-02
  Scenario: an interrupted step file still tears down its detached process tree
    Given a step file has launched a detached front-desk supervisor, bridge, bot, and tmux server rooted in a fixture directory
    When the runner is terminated with SIGTERM before the scenario's inline teardown runs
    Then no supervisor, bridge, or bot process rooted in that fixture survives
    And no tmux server for that fixture's socket survives

  # BL-458 fixture-process-leak-03
  Scenario: the reaper never signals a process rooted in the live swarm socket directory
    Given a live process is rooted in the running swarm socket directory /tmp/swarmforge-<uid>
    When the orphan reaper runs
    Then that process is left running regardless of its age
