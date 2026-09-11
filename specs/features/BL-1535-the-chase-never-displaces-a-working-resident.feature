Feature: BL-1535 The chase never displaces a working resident

  On a rotation-router pack the handoff daemon's chase rotates the single
  resident pane onto whichever dormant role has actionable mail. Its gate
  judges "busy" from the pane footer alone, so a role that holds a real
  in_process parcel but whose turn is inside a detached command, or whose
  forward stands between the two self-audit calls, reads idle and is
  respawned as another role - its session killed, its draft or its running
  command stranded. This feature is that the chase consults the departing
  role's in_process box and a working signal, refuses to depart a working
  holder for a different target, still yields an idle holder, and records
  every refusal.

  Background:
    Given a rotation-router fixture whose resident is seated as hardender
    And the hardender's inbox in_process holds a real parcel
    And an aged note waits in the specifier's inbox new

  # BL-1535 never-displaces-a-working-resident-01
  Scenario Outline: a working holder is not rotated away for a different target
    Given the resident pane footer reads idle
    And <signal>
    When the chase sweep decides whether to rotate the resident to "specifier"
    Then the rotation is refused as departing-mid-parcel
    And a telemetry row names hardender, the held parcel and the signal that held it

    Examples:
      | signal                                                              |
      | a command launched from the resident pane is still running          |
      | the hardender's forward stands mid-audit with a fresh challenge     |

  # BL-1535 never-displaces-a-working-resident-02
  Scenario: an idle holder still yields to dependency mail
    Given the resident pane footer reads idle
    And the resident pane's process tree holds only its shell
    And no audit challenge stands for the hardender
    When the chase sweep decides whether to rotate the resident to "specifier"
    Then the rotation proceeds

  # BL-1535 never-displaces-a-working-resident-03
  Scenario: a stale challenge alone does not hold the resident
    Given the resident pane footer reads idle
    And the resident pane's process tree holds only its shell
    And the hardender's audit challenge is older than the note actionability bound
    When the chase sweep decides whether to rotate the resident to "specifier"
    Then the rotation proceeds

  # BL-1535 never-displaces-a-working-resident-04
  Scenario: rotating into the role that owns the parcel is never a displacement
    Given the resident pane footer reads idle
    And a command launched from the resident pane is still running
    When the chase sweep decides whether to rotate the resident to "hardender"
    Then the rotation proceeds

  # BL-1535 never-displaces-a-working-resident-05
  Scenario: a working signal with no held parcel never pins the router
    Given the hardender's inbox in_process is empty
    And a command launched from the resident pane is still running
    When the chase sweep decides whether to rotate the resident to "specifier"
    Then the rotation proceeds

  # BL-1535 never-displaces-a-working-resident-06
  Scenario: a standing pack is untouched
    Given the fixture pack gives every role its own pane
    And a command launched from the resident pane is still running
    When the chase sweep decides whether to rotate the resident to "specifier"
    Then no rotation decision is made
    And no telemetry row is written
