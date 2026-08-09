Feature: a sibling deferral survives its blocker closing

  # BL-861 (live victim BL-574): under BL-532 a sibling with no failing check of its own is
  # DEFERRED pending the blocker, and is released only when QA explicitly runs `clear`. Two
  # things are missing from that lifecycle. First, nothing observes that the blocking ticket
  # has since CLOSED — no sweep, no watchdog, no daemon reads the deferral store, so a
  # released-in-fact sibling stays deferred until a human happens to ask about it. Second,
  # the check recorded at defer time is free-form text, and QA legitimately writes one that
  # reads the blocker's own ticket file under `backlog/active/`. Closing the blocker MOVES
  # that file to `backlog/done/`, so the recorded check stops being runnable at exactly the
  # moment it should be releasing the sibling. Observed 2026-08-09: BL-574's code had been
  # on `main` since 2026-08-08, both its blockers (BL-681, BL-762) had passed QA and closed,
  # and `status --ticket BL-574` still emitted two DEFERRED lines, one naming a check whose
  # path no longer exists. The ticket held an active slot with no QA verdict and no way to
  # earn one.

  Background:
    Given a sibling deferral store
    And ticket "BL-574" is deferred pending blocker "BL-681"

  # BL-861 check-must-outlive-the-close-01
  Scenario: a check that reads the blocker's own active-backlog file is refused at defer time
    When QA defers naming a check that reads the blocker's file under the active backlog
    Then the deferral is refused
    And QA is told the path moves when the blocker closes

  # BL-861 check-must-outlive-the-close-02
  Scenario: a check that does not depend on the blocker's ticket path is accepted
    When QA defers naming a check that runs a test suite
    Then the deferral is recorded

  # BL-861 closed-blocker-releases-the-sibling-03
  Scenario: a deferral whose blocker has closed is reported releasable, not blocked
    Given blocker "BL-681" has closed
    When the deferral status of ticket "BL-574" is requested
    Then ticket "BL-574" is reported releasable
    And the report names where blocker "BL-681" closed
    And no unrunnable check is emitted for ticket "BL-574"

  # BL-861 open-blocker-still-defers-04
  Scenario: a deferral whose blocker is still open is unchanged
    Given blocker "BL-681" is still open
    When the deferral status of ticket "BL-574" is requested
    Then ticket "BL-574" is reported deferred pending blocker "BL-681"

  # BL-861 stranded-deferrals-are-discoverable-05
  Scenario: listing open deferrals surfaces one whose blocker has already closed
    Given blocker "BL-681" has closed
    When open deferrals are listed
    Then ticket "BL-574" appears as stranded
    And the listing is available without naming ticket "BL-574" in advance

  # BL-861 mixed-blockers-report-per-blocker-06
  Scenario Outline: a ticket blocked by several tickets reports each blocker on its own state
    Given ticket "BL-574" is deferred pending blocker "BL-762"
    And blocker "BL-681" has closed
    And blocker "BL-762" <blocker_762_state>
    When the deferral status of ticket "BL-574" is requested
    Then ticket "BL-574" is reported <overall>

    Examples:
      | blocker_762_state | overall                        |
      | has closed        | releasable                     |
      | is still open     | deferred pending blocker BL-762 |
