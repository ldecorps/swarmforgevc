Feature: BL-1551 Chaser telemetry rows say what the adapter did: a skipped respawn is not a respawn, and a chase that rotates the resident is not a stall

  chase_sweep_lib's apply-inbox-item-action! writes a chaser telemetry row
  of type respawn immediately after calling the trigger-respawn adapter,
  whatever that adapter did. handoffd's adapter returns without touching a
  pane when the shared resident is busy (chase-respawn-skip-busy) or when
  it catches an error (chase-respawn-error). The lifecycle ledger folds
  every respawn row into a stall event and the closing-ceremony packet
  counts them, so the lean pass reads respawns that never happened. One
  rung down (absorbed from BL-1590, 2026-09-21): on a rotation-router pack
  the chase sweep's poke is often the daemon's own rotate of the resident
  to the chased role, the chase row does not say so, and the same fold
  turns router transport into a "chase pattern" hypothesis. This feature
  is that a respawn row is written only when the adapter invoked a launch
  script or a rotation, that an attempt it did not carry out is recorded
  under its own type, respawn-skipped, which the ledger and the packet
  count as an attention signal of their own, that a chase row names its
  poke (wake or rotate), that a row naming a rotation composes no stall,
  and that a row naming a wake or naming no poke composes exactly the
  stall it composes today.

  # BL-1551 skipped-respawn-01
  Scenario Outline: the respawn row's type follows what the adapter did
    Given a chase sweep whose inbox item has reached the respawn rung of the chase ladder
    And the trigger-respawn adapter reports it <did>
    When the sweep applies the respawned action
    Then the chaser telemetry gains one row of type <written> for the role carrying the item's chase count
    And the chaser telemetry gains no row of type <absent>

    Examples:
      | did                              | written         | absent          |
      | did not respawn because busy     | respawn-skipped | respawn         |
      | did not respawn because error    | respawn-skipped | respawn         |
      | invoked the role's launch script | respawn         | respawn-skipped |
      | rotated the resident to the role | respawn         | respawn-skipped |

  # BL-1551 skipped-respawn-02
  Scenario: the lifecycle ledger classifies respawn-skipped as an attention signal
    Given a chaser telemetry file holding one respawn-skipped row inside a role's ticket window
    When the lifecycle ledger composes that ticket's stall events
    Then one stall event with eventType respawn-skipped is composed for that role
    And the unrecognised chaser telemetry type report does not name respawn-skipped

  # BL-1551 skipped-respawn-03
  Scenario: the closing-ceremony packet counts skipped attempts under their own type
    Given a lifecycle ledger for one shift holding three respawn-skipped stalls and one respawn stall for QA
    When the closing-ceremony packet is folded for that shift
    Then the packet's stalls name QA respawn-skipped with count 3 and QA respawn with count 1

  # BL-1551 chase-rotate-not-a-stall-04
  Scenario Outline: the chase row names the poke that advanced it
    Given a chase sweep whose inbox item has reached the chased rung of the chase ladder
    And the send-wake-up adapter reports <result>
    When the sweep applies the chased action
    Then the chaser telemetry gains one row of type chase for the role carrying the item's chase count
    And that row's poke field <poke>

    Examples:
      | result                         | poke          |
      | a performed rotate             | reads rotate  |
      | an attempted wake              | reads wake    |
      | a plain boolean true           | is absent     |

  # BL-1551 chase-rotate-not-a-stall-05
  Scenario Outline: the lifecycle ledger composes a stall only for a chase that was not a rotation
    Given a chaser telemetry file holding one chase row <shape> inside a role's ticket window
    When the lifecycle ledger composes that ticket's stall events
    Then <count> stall events with eventType chase are composed for that role
    And the unrecognised chaser telemetry type report is empty

    Examples:
      | shape              | count |
      | naming poke rotate | 0     |
      | naming poke wake   | 1     |
      | naming no poke     | 1     |

  # BL-1551 chase-rotate-not-a-stall-06
  # Census pin (BL-1445): the test prints one PASS line per case, so the
  # new case is named literally; a runner that silently lost it would still
  # report all passed.
  Scenario: the daemon's own chase adapter reports a performed rotate as a rotate
    When the chase departing-mid-parcel gate shell test runs against the real handoffd.bb with a fake tmux
    Then it reports every check passed
    And its passing checks include case 08, a performed chase rotate whose chase row names poke rotate
