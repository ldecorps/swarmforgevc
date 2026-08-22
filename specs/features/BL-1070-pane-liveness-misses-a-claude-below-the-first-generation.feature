Feature: BL-1070 a pane's liveness verdict reads the whole tree under it, not one generation
  The babysitter decides a role is alive by looking for a claude process whose
  PPID equals the pane's pid - the FIRST generation only. Every role in this
  pack launches as pane `sh` -> `zsh <role>.sh` -> `claude`, so claude sits one
  generation lower and the predicate answers false for every healthy agent.

  Measured on this host 2026-08-22: all eight panes match that shape, and
  babysitterd.log at 16:24:46Z carries CRIT "pane alive but NO claude process
  under it (half-launch/exit)" for all eight roles at once, then NUDGED
  coordinator with 8 findings - while all eight agents were working.

  The verdict also gates the remote-control check, which therefore cannot run
  at all: a check silenced by another check's false negative reports nothing
  rather than reporting that it did not run.

  Background:
    Given a role pane the pack launched and whose agent is working

  # BL-1070 pane-liveness-depth-01
  Scenario Outline: the agent is found wherever it sits under the pane
    Given the claude process sits "<depth>"
    When the babysitter decides whether the role is alive
    Then the role is reported "<verdict>"

    Examples:
      | depth                          | verdict |
      | one generation below the pane  | alive   |
      | two generations below the pane | alive   |
      | three generations below the pane | alive |
      | nowhere under the pane         | absent  |

  # BL-1070 pane-liveness-scope-02
  Scenario: another role's agent never stands in for a missing one
    Given the claude process sits "nowhere under the pane"
    And another role's pane has a working agent under it
    When the babysitter decides whether the role is alive
    Then the role is reported "absent"

  # BL-1070 pane-liveness-gather-03
  Scenario: a failed process gather is still unavailable, never absence
    Given the process gather fails this sweep
    When the babysitter decides whether the role is alive
    Then the role is reported "unavailable"
    And no half-launch alert is raised for it

  # BL-1070 pane-liveness-gated-check-04
  Scenario Outline: a check gated on liveness runs, or says it could not
    Given the claude process sits "<depth>"
    And it was started without the remote-control flag
    When the babysitter runs its remote-control check
    Then the operator is told "<told>"

    Examples:
      | depth                          | told                       |
      | one generation below the pane  | remote control is degraded |
      | two generations below the pane | remote control is degraded |
      | nowhere under the pane         | the check could not be run |
