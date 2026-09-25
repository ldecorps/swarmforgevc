Feature: BL-1753 The closing ceremony never starts a documenter beside a mono-router resident

  At the night closing ceremony's briefing step, rotate_to_role.sh refuses
  while the resident still holds a parcel, and hotfix a27d082c2d
  (2026-09-16) then starts the documenter's own session beside
  the resident through consult_spawn_cli.bb. The briefing is work, and a
  mono-router pack has one resident. The human, 2026-09-25: "Mono router =
  1 resident". After this feature, when the plain rotate is refused, the
  ceremony forces the resident to documenter (SWARMFORGE_ROTATE_FORCE=1).
  The parcel the resident held stays in its role's in_process for the next
  shift, and no second session is ever started (the human's ruling B,
  2026-09-25).

  # BL-1753 no-documenter-session-beside-the-resident-01
  Scenario: the briefing phase starts no documenter session beside a resident that holds a parcel
    Given a mono-router fixture whose resident holds a coder parcel at the ceremony's drain deadline
    When the ceremony enters its briefing phase
    Then no tmux session is created
    And consult_spawn_cli.bb is not run

  # BL-1753 refused-rotate-is-forced-and-the-parcel-kept-02
  Scenario: a refused rotate is forced and the resident's parcel stays in_process
    Given a mono-router fixture whose resident holds a coder parcel at the ceremony's drain deadline
    When the ceremony enters its briefing phase
    Then the resident is rotated to documenter
    And the rotate was forced
    And the coder parcel is still in coder's in_process
    And the recorded closing sequence names rotate-documenter once

  # BL-1753 no-parcel-no-force-03
  Scenario: a resident holding no parcel is rotated without force
    Given a mono-router fixture whose resident holds no parcel at the ceremony's drain deadline
    When the ceremony enters its briefing phase
    Then the resident is rotated to documenter
    And the rotate was not forced

  # BL-1753 standing-pack-unchanged-04
  Scenario: on a standing pack the ceremony still instructs the documenter seat and starts nothing
    Given a standing-pack fixture whose documenter seat is live
    When the ceremony enters its briefing phase
    Then the documenter is instructed to write the briefing
    And no tmux session is created
