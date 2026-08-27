Feature: BL-980 each RECENTLY CLOSED line shows how long ago the ticket closed

  The board's RECENTLY CLOSED section lists id + slug with no sense of when
  anything closed, so a ticket closed ten minutes ago and one closed yesterday
  read identically on a phone. conciergeTick.ts already keeps a durable,
  monotonic per-ticket closure instant (TickState.doneClosedAtMs, stamped once
  and never restamped) and already SORTS the section by it - it is simply not
  carried through to the rendered line. Human addendum, 2026-08-20.

  Background:
    Given a pipeline board whose RECENTLY CLOSED section lists closed tickets

  # BL-980 recently-closed-elapsed-time-01
  Scenario Outline: the relative-age ladder
    Given a ticket closed <elapsed_ms> ms before the render instant
    When the RECENTLY CLOSED section renders
    Then its line ends with "(<age>)"

    Examples:
      | elapsed_ms | age        |
      | 20000      | just now   |
      | 59999      | just now   |
      | 60000      | 1min ago   |
      | 600000     | 10min ago  |
      | 3599999    | 59min ago  |
      | 3600000    | 1h ago     |
      | 86399999   | 23h ago    |
      | 86400000   | 1d ago     |
      | 604800000  | 7d ago     |

  # BL-980 recently-closed-elapsed-time-02
  Scenario: an unknown closure instant produces no age at all
    Given a closed ticket with no recorded closure instant
    When the RECENTLY CLOSED section renders
    Then its line carries no parenthetical age

  # BL-980 recently-closed-elapsed-time-03
  Scenario: the age comes from the durable closure record, not the file
    Given a ticket whose recorded closure instant is 2 hours before the render instant
    And whose backlog file was rewritten one minute before the render instant
    When the RECENTLY CLOSED section renders
    Then its line ends with "(2h ago)"

  # BL-980 recently-closed-elapsed-time-04
  Scenario Outline: only RECENTLY CLOSED lines gain the suffix
    Given the board renders its "<section>" section
    When the board body renders
    Then no line in that section carries a parenthetical age

    Examples:
      | section          |
      | PARKED           |
      | AWAITING APPROVAL|
      | ROOT INTAKE      |
      | grid captions    |
