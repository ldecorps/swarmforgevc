Feature: BL-1345 a mono-router resident marker never decides staffing on a standing pack

  `.swarmforge/mono-router-active-role` is the rotation-router pack's record of
  which role the single resident is currently wearing. On a standing pack -
  every role in its own pane - it means nothing, but it can still be lying
  around from an earlier router session, and a reader that does not ask which
  pack is running will honour it.

  These scenarios pin one thing: which role staffs a pane is decided by the
  running pack's topology, and the marker is consulted only where it applies.

  Background:
    Given a standing pack is running, with every role in its own pane

  # BL-1345 a-stale-router-marker-does-not-staff-a-standing-pack-01
  Scenario: A leftover marker does not decide who staffs a pane
    Given a leftover resident marker naming a role other than the pane's own
    When the swarm is relaunched
    Then each pane is staffed with the role its pack assigns it
    And no role has two live sessions

  # BL-1345 a-stale-router-marker-does-not-staff-a-standing-pack-02
  Scenario: A leftover marker does not decide who is respawned
    Given a leftover resident marker naming a role other than the pane's own
    And one role's session is missing
    When the health sweep repairs it
    Then the pane is restaffed with the role its pack assigns it

  # BL-1345 a-stale-router-marker-does-not-staff-a-standing-pack-03
  Scenario: The marker still governs a rotation-router pack
    Given a rotation-router pack is running
    And a resident marker naming a known role
    When the swarm is relaunched
    Then the resident boots as the role the marker names

  # BL-1345 a-stale-router-marker-does-not-staff-a-standing-pack-04
  Scenario Outline: An unusable marker never changes staffing
    Given a resident marker that is "<state>"
    When the swarm is relaunched
    Then each pane is staffed with the role its pack assigns it

    Examples:
      | state                   |
      | absent                  |
      | unreadable              |
      | naming an unknown role  |

  # BL-1345 a-stale-router-marker-does-not-staff-a-standing-pack-05
  Scenario: A role whose pane is mis-staffed is reported, not left silent
    Given a pane running a role other than the one its pack assigns it
    When the health sweep runs
    Then the mismatch is reported, naming the pane, the expected role and the observed one
