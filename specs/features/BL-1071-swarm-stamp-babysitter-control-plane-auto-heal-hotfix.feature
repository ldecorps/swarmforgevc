# mutation-stamp: sha256=2b19d2bc9bd4b0df6fdbe8d24acf22e03b2fb201b2052d841d2d283919a774e5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-23T06:05:50.008439049Z","feature_name":"BL-1071 one failing probe never takes the babysitter's whole sweep down with it","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a probe that fails degrades its own check and nothing else","scenario_hash":"9d7c15b2b2d311050fa15dea469c6d69519b8240e315dd80ade1a493656bcab7","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-23T06:05:44.924478248Z"},{"index":1,"name":"the plane response depends on whether roles can be respawned","scenario_hash":"3fb60f6609243ab1baee09509b3c61135b9daec9b62bc63a7f20dfe87e82483e","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-23T06:05:44.924478248Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1071 one failing probe never takes the babysitter's whole sweep down with it
  For hours on this host every babysitter tick threw before it reached
  `assemble-findings`: babashka's seeking `slurp` cannot read WSL's
  /proc/meminfo ("Invalid argument"), the fallback shelled macOS-only
  `vm_stat`, and `{:continue true}` softens a non-zero exit but not a spawn
  that never happens. babysitterd.log carried ~192 stack traces, zero
  "OK all checks green" and zero REPAIR lines, while an open
  control-plane-missing incident named babysitterd as the owner of
  `./swarm ensure` and no ensure ever ran.

  A human landed the repair by hand (commit f6b6aef25). This feature is the
  gate it never passed. The property under test is not "meminfo parses" - it
  is that no single probe can silence every other check and every repair.

  # BL-1071 sweep-survives-a-failing-probe-01
  Scenario Outline: a probe that fails degrades its own check and nothing else
    Given a sweep in which "<probe>" fails
    When the babysitter runs its sweep
    Then the sweep still reaches its findings
    And a repair that is due is still performed

    Examples:
      | probe                          |
      | the memory reading             |
      | the process table              |
      | the control-plane observation  |
      | every one of them at once      |

  # BL-1071 plane-response-matches-what-is-possible-02
  Scenario Outline: the plane response depends on whether roles can be respawned
    Given the control plane is missing
    And persisted launch scripts are "<scripts>"
    When the babysitter runs its sweep
    Then it "<response>"
    And per-role session creation is "<per-role>"

    Examples:
      | scripts | response                          | per-role  |
      | present | runs the whole-plane recovery     | suppressed |
      | absent  | escalates for a human relaunch    | suppressed |

  # BL-1071 recovery-is-bounded-in-time-03
  Scenario: a recovery that does not return still ends the sweep
    Given the control plane is missing
    And the whole-plane recovery does not return
    When the babysitter runs its sweep
    Then the sweep ends within its own bound
    And the recovery is reported as unfinished, not as repaired

  # BL-1071 recovery-is-bounded-in-attempts-04
  Scenario: a second sweep inside the cooldown does not recover again
    Given a whole-plane recovery ran on the previous sweep
    And the cooldown for that recovery has not elapsed
    When the babysitter runs its sweep
    Then no second recovery is started
    And the control plane is still reported as missing

  # BL-1071 unreadable-is-not-absent-05
  Scenario: a probe that cannot be read is unavailable, never an absence
    Given the process table cannot be gathered this sweep
    When the babysitter runs its sweep
    Then the live-process check is reported unavailable
    And no half-launch alert is raised for any role

  # BL-1071 unreadable-is-not-absent-06
  # Sibling of 05, for the one probe 05 does not cover. Scenario 01 already
  # lists the control-plane observation, but asserts only that the SWEEP
  # survives it (invariant 1) - a silently dropped observation passes 01
  # unchanged. This gates invariant 3 for that probe: unavailable, not silence.
  Scenario: an observation that throws is reported unavailable, never silence
    Given the control-plane observation throws this sweep
    When the babysitter runs its sweep
    Then the control-plane check is reported unavailable
    And the reason the observation failed is carried in that finding
    And no control-plane recovery is started
