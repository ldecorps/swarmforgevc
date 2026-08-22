Feature: Rolling mailbox retention drips settled mail out of the hot path

  Every mailbox walk in the swarm - the dropped-parcel sweep, the dispatch-gap
  scan, the unassigned-active nudge - lists inbox/completed/ and sent/ flat.
  Those two trees only ever grow: 12183 handoffs across the eight roles'
  mailboxes on 2026-08-22, of which 11793 are older than fourteen days. BL-978
  made one sweep read each of those files once instead of once per active
  ticket, and deliberately left retention out of scope as a decision needing a
  human call.

  This is that decision, as the human locked it: mail past a rolling window
  moves out of the hot listing into an archive under the same handoffs root.
  Nothing is deleted, and an archived trail stays readable where it lands, so
  an audit of a settled ticket can still follow it. Reduction is gradual - a
  bounded number of files per tick - so the first pass over today's backlog of
  eleven thousand drains across many cycles rather than in one shock.

  Two things are never archived at any age, and both are permanent safety
  rules rather than a boundary a later slice relaxes: live mail under new/ and
  in_process/, and any handoff naming a ticket in backlog/active/. Sparing
  active tickets costs almost nothing - a handful of tickets are active at a
  time - and it is what keeps every consumer's verdict about live work
  identical before and after a tick.

  Background:
    Given a retention window of 14 days
    And a retention pace ceiling of 200 handoffs per tick
    And the current time is 2026-08-22T12:00:00Z

  # BL-1073 rolling-mailbox-retention-01
  Scenario Outline: A retention tick moves settled mail past the window and nothing else
    Given a handoff in a settled mailbox dir recorded <age_days> days ago
    And that handoff names <ticket_state>
    When a retention tick runs
    Then the handoff is <disposition>

    Examples:
      | age_days | ticket_state                | disposition |
      | 30       | a ticket in backlog/done/   | archived    |
      | 3        | a ticket in backlog/done/   | retained    |
      | 30       | a ticket in backlog/active/ | retained    |
      | 30       | no ticket at all            | archived    |

  # BL-1073 rolling-mailbox-retention-02
  Scenario Outline: Live mail is never touched at any age
    Given a handoff recorded 30 days ago in a role's <live_dir>
    When a retention tick runs
    Then the handoff is retained
    And the archive does not hold it

    Examples:
      | live_dir          |
      | inbox/new/        |
      | inbox/in_process/ |

  # BL-1073 rolling-mailbox-retention-03
  Scenario: The pace ceiling drips the drain across many ticks
    Given 500 settled handoffs recorded 30 days ago
    When a retention tick runs
    Then 200 handoffs are archived and 300 are retained
    When a second retention tick runs
    Then 400 handoffs are archived and 100 are retained

  # BL-1073 rolling-mailbox-retention-04
  Scenario: Archiving moves mail without deleting it
    Given 40 settled handoffs recorded 30 days ago
    When a retention tick runs
    Then the total number of handoffs across the hot dirs and the archive is 40
    And every archived handoff is byte-identical to what it was before the tick
    And every archived handoff is readable at a path under the handoffs root
    And no archived handoff is returned by a flat listing of any hot mailbox dir

  # BL-1073 rolling-mailbox-retention-05
  Scenario Outline: Age comes from the handoff's own recorded time, not the file's mtime
    Given a settled handoff recorded <recorded> whose file mtime is <mtime>
    When a retention tick runs
    Then the handoff is <disposition>

    Examples:
      | recorded       | mtime       | disposition |
      | 30 days ago    | today       | archived    |
      | today          | 30 days ago | retained    |
      | at no readable time | 30 days ago | retained    |

  # BL-1073 rolling-mailbox-retention-06
  Scenario: A tick does not change what the dropped-parcel sweep concludes
    Given an active ticket whose trail spans settled mail older and newer than the window
    And the dropped-parcel sweep's verdict for that ticket is recorded before the tick
    When a retention tick runs
    Then the dropped-parcel sweep's verdict for that ticket is unchanged
    And the trail evidence the sweep reads for that ticket is unchanged

  # BL-1073 rolling-mailbox-retention-07
  Scenario: An interrupted tick loses nothing and duplicates nothing
    Given 40 settled handoffs recorded 30 days ago
    And a retention tick that is interrupted partway through
    When the mailboxes and the archive are listed
    Then every one of the 40 handoffs is present exactly once
    When a retention tick runs
    Then all 40 handoffs are archived and none is lost or duplicated
