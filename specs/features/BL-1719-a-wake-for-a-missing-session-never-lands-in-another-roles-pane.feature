Feature: BL-1719 A wake for a missing session never lands in another role's pane

  If a parcel's recipient has no tmux session, its wake is remapped to
  the mono-router resident: the first non-coordinator row of roles.tsv.
  That remap is right in a rotation-router pack, where dormant roles have no
  pane and the resident works their mail. It is wrong in a standing pack.
  On 2026-09-24 the coder@2 seat was dropped from the full-forge pack, and
  every later wake for coder@2 was typed into the specifier's pane, which
  found an empty mailbox each time. Meanwhile coder@2's parcels were woken
  nowhere. This feature is that a standing pack skips and logs such a wake
  instead of redirecting it, on both paths that deliver, and that a
  rotation-router pack keeps its remap.

  Background:
    Given a fixture project on a private tmux server whose roles.tsv lists the specifier first and a seat coder@2 with no session

  # BL-1719 a-standing-pack-never-redirects-a-wake-01
  Scenario Outline: in a standing pack a parcel for a seat with no session wakes no pane
    When <path> delivers a note to coder@2
    Then nothing is typed into the specifier's session or any other session
    And the wake is logged as skipped, naming coder@2's missing session
    And the note is in coder@2's inbox

    Examples:
      | path                    |
      | the sender's own send   |
      | the handoff daemon      |

  # BL-1719 a-rotation-router-pack-keeps-its-resident-remap-02
  Scenario: in a rotation-router pack a dormant role's wake still reaches the resident
    Given the fixture pack is a rotation-router pack whose resident session is coder's
    When the sender's own send delivers a note to a dormant role
    Then the wake is typed into the resident's session
