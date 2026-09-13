Feature: BL-1551 A skipped respawn is not a respawn

  chase_sweep_lib's apply-inbox-item-action! writes a chaser telemetry row
  of type respawn immediately after calling the trigger-respawn adapter,
  whatever that adapter did. handoffd's adapter returns without touching a
  pane when the shared resident is busy (chase-respawn-skip-busy) or when
  it catches an error (chase-respawn-error). The lifecycle ledger folds
  every respawn row into a stall event and the closing-ceremony packet
  counts them, so the lean pass reads respawns that never happened. This
  feature is that a respawn row is written only when the adapter invoked a
  launch script or a rotation, and that an attempt it did not carry out is
  recorded under its own type, respawn-skipped, which the ledger and the
  packet count as an attention signal of their own.

  Background:
    Given a chase sweep whose inbox item has reached the respawn rung of the chase ladder

  # BL-1551 skipped-respawn-01
  Scenario Outline: the telemetry row's type follows what the adapter did
    Given the trigger-respawn adapter reports it <did>
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
