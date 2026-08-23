Feature: A closed ticket's measured duration ends at its close, not at a later re-file
  Mean ticket time is derived from the backlog file's own path history in git.
  A ticket's END is read as the newest arrival at the path the file sits at
  TODAY, so a ticket that was re-filed after it closed - moved under a
  milestone directory, or moved again when that directory was renamed -
  measures to the re-file rather than to the close, and its reported duration
  is inflated by however long the re-file came afterwards. These scenarios fix
  the END at the close, and pin that nothing committed after a ticket closed
  can move its duration again.

  Background:
    Given a fixture repository with a backlog containing "active" and "done" directories

  # BL-1074 post-close-refile-duration-01
  Scenario Outline: a ticket re-filed inside done/ after its close still measures to the close
    Given ticket "BL-019" was promoted into backlog/active/ at "2026-07-01T08:00:00"
    And ticket "BL-019" was closed into backlog/done/ at "2026-07-01T13:00:00"
    And ticket "BL-019" was then re-filed <hops> further times inside done/, the last at "2026-07-03T09:00:00"
    When mean ticket time is computed over that repository
    Then the reported mean is "5h" over 1 ticket

    Examples:
      | hops |
      | 1    |
      | 2    |

  # BL-1074 post-close-refile-duration-02
  Scenario: a ticket that was never re-filed measures the same as before
    Given ticket "BL-020" was promoted into backlog/active/ at "2026-07-01T08:00:00"
    And ticket "BL-020" was closed into backlog/done/ at "2026-07-01T13:00:00"
    When mean ticket time is computed over that repository
    Then the reported mean is "5h" over 1 ticket

  # BL-1074 post-close-refile-duration-03
  Scenario: a reopened ticket re-filed after its second close measures only its last cycle
    Given ticket "BL-021" was promoted into backlog/active/ at "2026-07-01T08:00:00"
    And ticket "BL-021" was closed into backlog/done/ at "2026-07-01T13:00:00"
    And ticket "BL-021" was reopened into backlog/active/ at "2026-07-02T08:00:00"
    And ticket "BL-021" was closed into backlog/done/ at "2026-07-02T11:00:00"
    And ticket "BL-021" was then re-filed 1 further times inside done/, the last at "2026-07-04T09:00:00"
    When mean ticket time is computed over that repository
    Then the reported mean is "3h" over 1 ticket

  # BL-1074 post-close-refile-duration-04
  Scenario: renaming a milestone directory does not move the corpus mean
    Given ticket "BL-019" was promoted into backlog/active/ at "2026-07-01T08:00:00"
    And ticket "BL-019" was closed into backlog/done/ at "2026-07-01T13:00:00"
    And ticket "BL-022" was promoted into backlog/active/ at "2026-07-01T09:00:00"
    And ticket "BL-022" was closed into backlog/done/ at "2026-07-01T13:00:00"
    And both tickets were re-filed under a done/ milestone directory at "2026-07-02T09:00:00"
    And mean ticket time was computed over that repository and recorded
    When that done/ milestone directory is renamed at "2026-07-05T09:00:00"
    And mean ticket time is computed over that repository
    Then the reported mean equals the recorded mean
    And the reported mean is "4h 30m" over 2 tickets
