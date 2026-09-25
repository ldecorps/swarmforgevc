Feature: BL-1752 The chase never starts a second session on a mono-router pack

  A mono-router pack has one resident agent that plays every role in turn
  (swarmforge/packs/mono-router.conf, line 1). Hotfix 5bdf93beed
  (2026-09-12) made the chase start a role's full session beside that
  resident whenever the resident refused to leave a parcel mid-turn
  (:departing-mid-parcel). The second session ran the whole role loop until
  its mailbox was empty. The human, 2026-09-25: "Mono router = 1 resident".
  After this feature, mail for another role waits for the resident, which
  the chase rotates as soon as its turn ends.

  Background:
    Given a mono-router fixture whose resident is seated as documenter

  # BL-1752 chase-never-spawns-for-mail-01
  Scenario Outline: mail for another role never starts a second session while the resident works
    Given the resident holds a documenter parcel and is mid-turn
    And specifier's mailbox holds <mail>
    When the chase sweep runs
    Then no tmux session is created
    And no consult marker is written

    Examples:
      | mail                             |
      | a git_handoff parcel             |
      | a note from documenter           |
      | a raw intake in the backlog root |

  # BL-1752 resident-serves-the-mail-when-its-turn-ends-02
  Scenario: the waiting mail is served once the resident's turn ends
    Given the resident holds a documenter parcel and is mid-turn
    And specifier's mailbox holds a git_handoff parcel
    When the resident's turn ends
    And the chase sweep runs
    Then the resident is rotated to specifier
    And no tmux session is created

  # BL-1752 retired-knob-is-inert-03
  Scenario: a pack conf that still carries the single-inference-slot knob launches and chases like one without it
    Given the pack conf also carries the line "config single_inference_slot 1"
    And the resident holds a documenter parcel and is mid-turn
    And specifier's mailbox holds a git_handoff parcel
    When the pack conf is parsed
    And the chase sweep runs
    Then the parse succeeds
    And no tmux session is created
