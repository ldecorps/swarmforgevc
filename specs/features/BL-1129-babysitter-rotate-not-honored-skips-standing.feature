Feature: BL-1129 babysitter rotate-not-honored skips standing packs
  # Companion to BL-804 topology awareness. On standing packs every role has
  # its own pane; rotate_to_role.sh refuses and mono-router-active-role is
  # absent by design. check-rotate-not-honored must not CRIT that shape.

  # Design lock (specifier 2026-08-25):
  # - Reuse mono_router_lib / pack topology resolution already used by
  #   babysitter_check (BL-804) — never a private second parser.
  # - Standing (non-rotating) pack: suppress rotate-not-honored entirely
  #   (no CRIT/WARN noise); empty mono-router-active-role is expected.
  # - Rotating / mono-router packs: keep existing check behavior when a
  #   completed rotate note was not honored.
  # - Do not re-issue rotate_to_role from coordinator on standing packs.

  # BL-1129 standing-pack-no-rotate-crit-01
  Scenario: a standing pack never emits rotate-not-honored CRIT
    Given the live pack topology is standing (every roles.tsv role has its own pane)
    And mono-router-active-role is absent
    And a completed coordinator note told a role to rotate_to_role.sh another role
    When babysitter check-rotate-not-honored runs
    Then it emits no rotate-not-honored finding

  # BL-1129 rotating-pack-still-detects-02
  Scenario: a rotating pack still CRITs an unhonored rotate note
    Given the live pack topology rotates roles through a shared pane
    And a completed note told the resident to rotate_to_role.sh a target role
    And after the honor window the active role is not that target
    When babysitter check-rotate-not-honored runs
    Then it emits a rotate-not-honored finding naming the expected target
