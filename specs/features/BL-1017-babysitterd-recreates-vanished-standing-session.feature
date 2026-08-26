Feature: a vanished standing role session is recreated, not merely alerted about

  BL-1017: babysitterd_sweep_lib's check-live-session emits a CRIT
  ("swarmforge-<role>: tmux session missing") and stops there. Nothing
  recreates the session, so a standing full-forge role that vanishes stays
  gone until a human runs a full ./start-swarm.sh - which recreates all eight
  sessions and is far more disruptive than the fault. Observed recurring as a
  CRIT on 2026-08-19 (many), 2026-08-20 and 2026-08-21 for the specifier.

  This slice adds a bounded REPAIR decision alongside the existing CRIT. It
  changes what the pure sweep decision returns; executing the decision is the
  daemon's existing single-role launch path, not a new mechanism.

  Background:
    Given a standing full-forge pack whose rotation is empty

  # BL-1017 babysitterd-recreates-vanished-standing-session-01
  Scenario: a standing role with no pane asks for its session to be recreated
    Given role "specifier" whose pane does not exist
    And the topology says that role should stand
    When the sweep assesses that role
    Then a CRIT reporting the missing session is still emitted
    And a repair decision to ensure that role's session is emitted alongside it

  # BL-1017 babysitterd-recreates-vanished-standing-session-02
  Scenario: topology suppression covers the repair branch, not only the alert
    Given role "cleaner" whose pane does not exist
    And the topology says that role should not stand
    When the sweep assesses that role
    Then no CRIT is emitted
    And no repair decision is emitted

  # BL-1017 babysitterd-recreates-vanished-standing-session-03
  Scenario Outline: a present pane is never treated as a missing session
    Given role "coder" whose pane exists
    And the pane process state is <process state>
    When the sweep assesses that role
    Then no repair decision is emitted

    Examples:
      | process state              |
      | a live claude process      |
      | no claude process under it |
      | a failed process gather    |

  # BL-1017 babysitterd-recreates-vanished-standing-session-04
  Scenario: a role repaired inside the cooldown window is not repaired again
    Given role "specifier" whose pane does not exist
    And that role was already issued a repair inside the cooldown window
    When the sweep assesses that role
    Then no repair decision is emitted
    And a CRIT reporting the missing session is still emitted
