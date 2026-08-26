Feature: BL-990 a bounce's attribution can be corrected without rewriting history

  A bounce recorded against the wrong role is read by every downstream metric,
  including one feeding a live experiment, and today nothing can correct it:
  the CLI only appends, and a human-readable note reaches no consumer. The
  correction therefore has to be a record, not prose.

  It also has to leave the original in place. The store is an audit trail, and
  the fact that a misattribution happened is itself evidence worth keeping, so
  a correction supersedes rather than edits.

  Background:
    Given a bounce store holding a recorded bounce for ticket "BL-971" at commit "8956d30eee"

  # BL-990 bounce-attribution-correctable-01
  Scenario: a correction supersedes the original without altering it
    When a correction is recorded with a reason
    Then the original record is still present unchanged
    And the correction is appended after it as a new record

  # BL-990 bounce-attribution-correctable-02
  Scenario Outline: every consumer of the store reports the corrected attribution
    Given a correction has already been recorded
    When "<consumer>" reports its bounce attribution
    Then it reports the corrected attribution rather than the original

    Examples:
      | consumer               |
      | qaBounceStore          |
      | failureModeInventory   |
      | reworkRounds           |
      | leanLedgerComposeBounce|

  # BL-990 bounce-attribution-correctable-03
  Scenario: a correction without a reason is refused
    When a correction is recorded with no reason
    Then the correction is refused
    And the store is unchanged

  # BL-990 bounce-attribution-correctable-04
  Scenario: correcting one bounce lowers the blamed role's count and raises the record count
    Given the blamed role's bounce count for that day is known
    When a correction is recorded with a reason
    Then the blamed role's count for that day falls by exactly one
    And the total number of records in the store rises by exactly one

  # BL-990 bounce-attribution-correctable-05
  Scenario: recording the same correction twice is a no-op
    Given a correction has already been recorded
    When the identical correction is recorded again
    Then the store is unchanged
