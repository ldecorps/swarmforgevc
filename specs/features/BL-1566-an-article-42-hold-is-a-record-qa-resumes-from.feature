Feature: BL-1566 An Article 4.2 hold is a record QA resumes from

  Article 4.2 lets QA withhold approval on a red with no open ticket, and
  the parcel waits. The wait had no resume: the hold lived in an evidence
  file, QA completed the parcel so the resident could rotate, and when the
  owner was minted and the resume note arrived QA completed that note in
  ten seconds with nothing to re-gate (BL-1555, 2026-09-14 12:16Z). This
  feature is that a hold is a durable record naming the parcel commit and
  its reds; the standing-red register alone releases it; every QA turn
  prints a released hold before anything else; and a note cannot be
  completed while a released hold is open, until QA closes the hold with an
  outcome.

  Background:
    Given a fixture project root with an empty standing-red register, empty backlog folders and a QA mailbox
    And QA has opened a hold for task "BL-9000-held" on commit "abcdef0123" naming the reds "extension/test/a.property.test.js, extension/test/b.property.test.js"

  # BL-1566 article-42-hold-record-01
  Scenario: an open hold reports each red with no owner and no release
    When the hold status is read
    Then it prints a HOLD line for "extension/test/a.property.test.js" with owner "none"
    And it prints a HOLD line for "extension/test/b.property.test.js" with owner "none"
    And it prints no RELEASED line

  # BL-1566 article-42-hold-record-02
  Scenario Outline: the register releases a hold only when every red it names has an open owner
    Given the register names "<owner_a>" as the owner of "extension/test/a.property.test.js"
    And the register names "<owner_b>" as the owner of "extension/test/b.property.test.js"
    And the ticket "<owner_a>" sits in "<folder_a>"
    And the ticket "<owner_b>" sits in "<folder_b>"
    When the hold status is read
    Then it <prints> the line "RELEASED BL-9000-held abcdef0123"

    Examples:
      | owner_a | folder_a | owner_b | folder_b | prints         |
      | BL-9001 | paused   | none    | none     | does not print |
      | BL-9001 | paused   | BL-9002 | active   | prints         |
      | BL-9001 | done     | BL-9002 | active   | does not print |

  # BL-1566 article-42-hold-record-03
  Scenario: a released hold refuses to let QA complete a note
    Given the hold for "BL-9000-held" is released
    And QA's in_process holds a note
    When done_with_current runs as QA
    Then it exits non-zero
    And it prints "HOLD_RELEASED BL-9000-held abcdef0123"
    And the note is still in QA's in_process

  # BL-1566 article-42-hold-record-04
  # Parking: QA completes the withheld parcel itself so the mono-router
  # resident can rotate; the hold, not the parcel's presence, is the memory.
  Scenario: an unreleased hold never blocks completing the parcel QA parks
    Given QA's in_process holds a git_handoff for task "BL-9000-held"
    When done_with_current runs as QA
    Then it exits zero
    And QA's in_process is empty

  # BL-1566 article-42-hold-record-05
  Scenario: every QA turn prints a released hold before anything else
    Given the hold for "BL-9000-held" is released
    And QA's mailbox is empty
    When ready_for_next runs as QA
    Then its first output line is "RELEASED BL-9000-held abcdef0123"
    And its output also reports NO_TASK

  # BL-1566 article-42-hold-record-06
  Scenario: closing the hold with an outcome ends the block
    Given the hold for "BL-9000-held" is released
    And QA's in_process holds a note
    When QA closes the hold with outcome "approved"
    And done_with_current runs as QA
    Then it exits zero
    And the hold record sits under the closed holds with outcome "approved"
