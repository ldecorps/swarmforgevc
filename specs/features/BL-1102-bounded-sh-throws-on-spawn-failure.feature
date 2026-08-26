# mutation-stamp: sha256=e7c95e2c2fb392cb039c19af17b27d1ad72d4d32065cb534522f5808e4ef5c45
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T10:09:22.680820179Z","feature_name":"the daemon's bounded shell-out returns a spawn failure instead of throwing it","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1102-bounded-sh-throws-on-spawn-failure.feature","background_hash":"06186a57be59a398e1c707e35df6a7b54b02646ee048b7a5c15d3d97179b9bbd","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a command that cannot be spawned comes back as a result, not a throw","scenario_hash":"8412672d38f6168093119aa02f226d51f4009ed03316de27fbfa3e334cda9b39","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-24T10:09:22.680820179Z"}]}
# acceptance-mutation-manifest-end

Feature: the daemon's bounded shell-out returns a spawn failure instead of throwing it

  Every subprocess the handoff daemon runs goes through
  daemon_cycle_guard_lib/sh!, which bounds the wait and returns a result map so
  callers can branch on :exit. It does not bound the SPAWN: when the binary
  cannot be started at all, ProcessBuilder throws IOException straight through
  sh! and out of the caller. The daemon's delivery loop has no catch of its
  own, so one unspawnable binary ends the loop. A spawn that never happened is
  not a command that ran and failed, and it is not a bound that expired: sh!
  must return it as its own outcome, distinguishable from both, so that a
  caller which already handles failure handles this too and the daemon keeps
  ticking.

  Background:
    Given a caller that shells a command through the daemon's bounded shell-out

  # BL-1102 spawn-failure-returns-01
  Scenario Outline: a command that cannot be spawned comes back as a result, not a throw
    Given the command is <command>
    When the caller shells it
    Then the caller receives a result reporting a spawn failure and nothing is thrown

    Examples:
      | command                            |
      | a binary absent from every PATH entry |
      | a path that does not exist         |
      | a path that exists but is not executable |

  # BL-1102 spawn-failure-returns-02
  Scenario: a spawn failure is distinguishable from a command that ran and failed
    Given one command that cannot be spawned and one that runs and exits non-zero
    When the caller shells each of them
    Then the two results differ in a field the caller can branch on

  # BL-1102 spawn-failure-returns-03
  Scenario: a command that does spawn is unchanged
    Given a command that runs and writes to both stdout and stderr
    When the caller shells it
    Then the result carries the same exit code, stdout and stderr as before

  # BL-1102 spawn-failure-returns-04
  Scenario: the delivery loop outlives an unspawnable binary
    Given the daemon is running and the binary its delivery tick shells is absent from PATH
    When a delivery tick runs
    Then the tick records the spawn failure and the daemon completes a further tick
