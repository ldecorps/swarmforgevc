Feature: Ambulance mode holds every parcel except one ticket's

  The escalation ladder had a hole in the middle. Rung 1, the Article 3.2.4
  expedite lane, only reorders PROMOTION — once a ticket is in transit,
  broadcasts, merge-ups, intake drains and the resident's home-queue bias all
  still interleave with it. Rung 3, the Expeditor, stops the whole swarm and
  drives one ticket through an offline pipeline; it was built for a pipeline
  that is itself the casualty, and using it on a healthy one throws away the
  real transport, the real gates and the real telemetry. This slice is rung 2:
  the swarm keeps running — every daemon, every alarm, every topic — and one
  durable marker names the single ticket whose parcels are allowed to move.

  Everything else is HELD, not cancelled. A held parcel stays byte-for-byte in
  the queue it already occupies; nothing is delivered onward, dropped,
  quarantined, abandoned or rewritten while the mode is engaged, and releasing
  the mode delivers every one of them intact. That non-loss property is what
  separates an ambulance from a stop.

  Attribution is by ticket id, and it fails OPEN: a parcel that mentions no
  ticket id at all counts as lineage and moves. A `note` carries no `task:`
  header, so a bounce or a steering message that forgot to name its ticket
  would otherwise be held forever and deadlock the very ticket the ambulance
  was called for. Only a parcel positively attributed to a DIFFERENT ticket is
  held.

  Background:
    Given a running mono-router swarm with a mailbox for every role

  # BL-655 ambulance-hold-01
  Scenario: engaging the ambulance holds every parcel attributed to another ticket
    Given the ambulance marker names BL-654
    And a git_handoff for task BL-654 is queued in the coder outbox
    And a git_handoff for task BL-660 is queued in the coder outbox
    When the handoff daemon runs one delivery poll
    Then the parcel for BL-654 has been delivered
    And the parcel for BL-660 is still queued unmodified
    And no parcel has been moved to failed, abandoned or completed

  # BL-655 ambulance-hold-02
  Scenario: releasing the ambulance delivers every held parcel intact
    Given the ambulance marker names BL-654
    And three git_handoffs for task BL-660 have been held across two delivery polls
    When the ambulance is released
    And the handoff daemon runs one delivery poll
    Then all three parcels for BL-660 have been delivered
    And each delivered parcel is byte-identical to the parcel that was held
    And the delivered set matches what the same fixture delivers with no ambulance engaged

  # BL-655 ambulance-hold-03
  Scenario Outline: attribution decides the hold, and an unattributed parcel moves
    Given the ambulance marker names BL-654
    And a parcel whose text mentions <mentions> is queued in the coder outbox
    When the handoff daemon runs one delivery poll
    Then that parcel is <outcome>

    Examples:
      | mentions               | outcome   |
      | BL-654                 | delivered |
      | BL-660                 | held      |
      | no ticket id           | delivered |
      | both BL-654 and BL-660 | delivered |

  # BL-655 ambulance-hold-04
  Scenario: a held parcel already sitting in an inbox is never claimed
    Given the ambulance marker names BL-654
    And a git_handoff for task BL-660 is queued in the cleaner inbox
    When the cleaner asks for its next task
    Then no task is claimed
    And the parcel for BL-660 is still queued unmodified

  # BL-655 ambulance-hold-05
  Scenario: rotation prefers the ambulance parcel over newer mail elsewhere
    Given the ambulance marker names BL-654
    And a git_handoff for task BL-654 is queued in the architect inbox
    And a newer git_handoff for task BL-660 is queued in the documenter inbox
    When the resident rotation target is chosen
    Then the resident rotates to architect

  # BL-655 ambulance-hold-06
  Scenario: a priority 00 note for another ticket never diverts the resident
    Given the ambulance marker names BL-654
    And the resident holds the parcel for BL-654
    And a priority 00 note naming BL-660 is queued for the resident's own role
    When the handoff daemon runs one delivery poll
    And the resident asks for its next task
    Then the resident's claim is unchanged
    And the parcel for BL-660 has never been claimed

  # BL-655 ambulance-hold-07
  Scenario: a batch containing both delivers only the ambulance parcels
    Given the ambulance marker names BL-654
    And two git_handoffs for task BL-654 and three for task BL-660 are queued for a batch role
    When the handoff daemon runs one delivery poll
    Then only the two parcels for BL-654 have been delivered
    And the three parcels for BL-660 are still queued unmodified

  # BL-655 ambulance-hold-08
  Scenario Outline: a marker that does not name one live ticket reads as mode off
    Given the ambulance marker is <marker>
    And a git_handoff for task BL-660 is queued in the coder outbox
    When the handoff daemon runs one delivery poll
    Then the parcel for BL-660 has been delivered
    And the daemon log records that ambulance mode is not engaged

    Examples:
      | marker                       |
      | absent                       |
      | an empty file                |
      | unparseable JSON             |
      | JSON carrying no ticket id   |
      | naming a ticket with no file |

  # BL-655 ambulance-hold-09
  Scenario Outline: engaging and releasing are idempotent
    Given the ambulance marker names BL-654
    When the ambulance command <command> is run twice in a row
    Then the second run reports success and changes nothing
    And every queue holds exactly the parcels it held before the first run

    Examples:
      | command       |
      | engage BL-654 |
      | release       |

  # BL-655 ambulance-hold-10
  Scenario: the human engages the ambulance from the Control topic
    Given no ambulance is engaged
    And a ticket BL-654 exists
    When the human sends "ambulance BL-654" in the Control topic
    Then the ambulance marker names BL-654
    And the Control topic is told the ambulance is engaged for BL-654

  # BL-655 ambulance-hold-11
  Scenario: the human releases the ambulance from the Control topic
    Given the ambulance marker names BL-654
    When the human sends "ambulance off" in the Control topic
    Then no ambulance is engaged
    And the Control topic is told the ambulance is released

  # BL-655 ambulance-hold-12
  Scenario: the human tries to engage the ambulance for a ticket that does not exist
    Given no ambulance is engaged
    When the human sends "ambulance BL-9999999" in the Control topic
    Then no ambulance is engaged
    And the Control topic is told the engage was refused for BL-9999999
