Feature: The bridge event snapshot carries only what its consumers read
  buildBridgeState embeds readBacklogFolders whole - active, paused, hold
  AND done - so the /events connect frame measured 6764293 bytes on
  2026-09-02, carrying the full description, notes and acceptance body of
  every one of 1259 tickets, roughly 1200 of them long-closed. That frame is
  re-sent in full to every SSE client on ANY backlog change, and again to
  each client on every reconnect. Consumers read a handful of per-item
  fields; the rest is prose nothing on the stream ever displays.

  Background:
    Given a target whose backlog holds 1200 done items, 20 paused items and 3 active items
    And every item carries a long description and long notes
    And a client connected to /events

  # BL-1351 event-snapshot-consumers-01
  Scenario Outline: Every snapshot the stream emits fits the budget
    When <trigger>
    Then the latest snapshot is under 512000 bytes

    Examples:
      | trigger                                                |
      | nothing changes                                        |
      | one active item changes and the poll loop rebroadcasts |

  # BL-1351 event-snapshot-consumers-02
  Scenario: No consumer loses a field it reads
    Then every field the enumerated /events consumers read is present for every item in the latest snapshot

  # BL-1351 event-snapshot-consumers-03
  Scenario: Both snapshot producers emit the same shape
    When one active item changes and the poll loop rebroadcasts
    Then the latest snapshot carries the same per-item fields as the connect snapshot
