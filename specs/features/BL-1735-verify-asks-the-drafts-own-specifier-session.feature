Feature: BL-1735 Verify asks the draft's own specifier session

  BL-1734's Verify runs only the host's own checks. The human asked for
  the specifier to "run is usual skills on it (dry, invest, etc)". So each
  draft gets its own specifier session, a one-shot Claude run outside the
  pipeline at any hour, that reviews the draft against INVEST. It can read
  the draft, the vocabulary, the backlog, the feature files and the docs,
  and nothing else: no writes, no commits, no shell. Its findings join
  Verify's list as ordinary suggestions. A later Verify on the same draft
  resumes the same session, so it remembers what it already said. The
  session never reaches the pipeline specifier seat.

  Background:
    Given a draft is open in the form

  # BL-1735 the-sessions-findings-join-the-list-01
  Scenario: the specifier session's findings are listed as suggestions
    Given the specifier session finds that the draft bundles two separate outcomes
    When I press Verify
    Then a suggestion names that finding with Accept and Reject

  # BL-1735 the-session-can-only-read-02
  Scenario: the specifier session is started with read tools only
    When I press Verify
    Then the specifier session is started with only file-reading tools
    And it has no tool that writes, edits or runs a shell command

  # BL-1735 a-second-verify-resumes-the-session-03
  Scenario: a second Verify on the same draft resumes the same session
    Given I pressed Verify on the draft once
    When I press Verify again
    Then the second Verify runs in the same specifier session as the first

  # BL-1735 verify-never-reaches-the-pipeline-specifier-04
  Scenario: Verify never reaches the pipeline specifier seat
    Given the day-shift swarm is running
    When I press Verify
    Then no parcel or question reaches the pipeline specifier seat
