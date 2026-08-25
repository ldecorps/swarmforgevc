Feature: A mono-router resident stranded off its home role is detected from outside its own turn

  Under a mono-router pack one resident process plays every role in turn. The
  protocol's last step is to rotate — back home, or on to the role it just handed
  the parcel to. When a turn ends without that step, the resident sits in a
  non-home role with an empty mailbox and nothing wakes it: dormant roles are not
  poked, so the pipeline stops silently while every dashboard still reads green.

  Both existing safeguards miss this by construction, and for the same reason:
  each is triggered by an action the stranded resident did not take. The
  `ROTATE_HOME` backstop only fires if the resident runs `ready_for_next.sh`, and
  the resident never ran it. The `rotate-unhonored` check looks for a completed
  parcel carrying a rotate instruction, and no such instruction was ever written.
  Detection therefore has to come from a layer that watches from outside the
  resident's own turn.

  Measured 2026-07-26: the resident finished a real batch as specifier at 20:38Z
  and ended its turn deliberately. Nine-plus minutes later the active-role file
  still read `specifier`, both its mailboxes were empty, and two pane captures
  fifteen minutes apart were byte-identical.

  Background:
    Given a mono-router swarm whose home role is coder

  # BL-685 stranded-resident-01
  Scenario: an idle resident left in a non-home role past the grace period is reported
    Given the resident is in a non-home role
    And its mailbox is empty
    And its pane has been idle past the grace period
    When the deterministic sweep runs
    Then a stranded-resident finding is reported
    And the finding names the role the resident is stuck in

  # BL-685 stranded-resident-02
  Scenario Outline: a resident that is not stranded is never reported
    Given the resident is <situation>
    When the deterministic sweep runs
    Then no stranded-resident finding is reported

    Examples:
      | situation                                       |
      | in its home role and idle                       |
      | in a non-home role and busy                     |
      | in a non-home role holding an in_process parcel  |
      | in a non-home role idle within the grace period  |
      | in a non-home role having asked for dispatch    |

  # BL-685 stranded-resident-03
  Scenario: the check fires where rotate-unhonored structurally cannot
    Given the resident is stranded in a non-home role
    And no rotate instruction was ever issued to it
    When the deterministic sweep runs
    Then a stranded-resident finding is reported
    And no rotate-unhonored finding is reported

  # BL-685 stranded-resident-04
  Scenario: the finding nudges the coordinator once per cooldown
    Given the resident is stranded in a non-home role
    When the sweep runs twice within the cooldown
    Then the coordinator is nudged exactly once

  # BL-685 stranded-resident-05
  Scenario: the sweep never touches the stranded pane
    Given the resident is stranded in a non-home role
    When the deterministic sweep runs
    Then no keystroke is sent to the resident pane
