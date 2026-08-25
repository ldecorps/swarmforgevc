Feature: BL-930 orphan janitor reaps tmp-rooted onboarder leftovers
  `tmp-ancillary-cmdline?` admits babysitter, tmux, front-desk bridge/bot and
  stray `claude -n Babysitter` under a disposable root, but not the onboarder.
  A fixture run of test_onboarder_supervisor_tick.sh that dies between
  `mktemp -d` and its teardown therefore leaves `bb onboarder_supervisor.bb`
  and `node onboarder-reconcile.js <root> poll-loop` running against a deleted
  cwd, and no sweep ever considers them (observed 2026-08-18: ~15% CPU on a
  2-core box, root /var/folders/.../T/tmp.KTEWg2bJ/swarm). This adds the two
  onboarder entry points to that catalog, disposable-root gated exactly as
  front-desk already is. PPID 1 is a NORMAL steady state for this class - a
  `--check-once` supervisor spawns the poll-loop and exits immediately - so it
  never buys a fast path, and a host-repo onboarder is never a candidate at
  all.

  Background:
    Given a host running the orphan janitor sweep

  # BL-930 tmp-rooted-onboarder-reaped-01
  Scenario Outline: a stale tmp-rooted onboarder leftover is reaped
    Given an ancillary process running under a disposable root
    And its command line names <ancillary>
    And it is older than the ancillary age gate
    And its parent process is gone
    When the sweep runs
    Then the process is reaped
    And the audit line for that reap names the disposable root

    Examples:
      | ancillary                     |
      | the onboarder reconcile loop  |
      | the onboarder supervisor      |

  # BL-930 no-parent-orphaned-fast-path-02
  # PPID 1 carries no signal here: --check-once exits by design, so a LIVE
  # fixture's poll-loop is parent-orphaned within milliseconds of starting.
  # Both rows must survive the sweep - the age gate is the only licence.
  Scenario Outline: a young tmp-rooted onboarder survives whatever its parent is doing
    Given an ancillary process running under a disposable root
    And its command line names the onboarder reconcile loop
    And it is younger than the ancillary age gate
    And its parent process is <parent state>
    When the sweep runs
    Then the process is not reaped

    Examples:
      | parent state |
      | gone         |
      | alive        |

  # BL-930 host-repo-onboarder-never-candidate-03
  Scenario: a host-repo onboarder is never a candidate, however orphaned
    Given a process with no extractable disposable root
    And its command line names the onboarder reconcile loop
    And it is older than the ancillary age gate
    And its parent process is gone
    When the sweep runs
    Then the process is not reaped
    And no reap decision is taken against it
