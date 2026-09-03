Feature: The mechanical share of a turn is readable

  BL-664 built a transcript walker that classifies every role turn as
  git-mechanical, test-run, file-read, thinking-writing, turn-overhead or
  provider-outage, and a series builder that folds those into a trend per
  stage. The epic that commissioned it said its numbers would size and order
  every remaining transit optimization before those slices were specced.

  `buildTurnProfileSeries` has zero production importers. Nothing calls it, so
  no trend exists, so no slice has ever been sized by it. The 2026-09-03
  determinism sweep had to count commits by hand off git history instead —
  a proxy that misses the cost entirely when a turn produces no commit, which
  is exactly the shape of the ceremony-note turn that prompted the sweep.

  Two things must not be confused once the series exists: a stage nobody worked
  and a stage measured at zero. Silence is not a measurement.

  Background:
    Given role transcripts covering a window have been walked

  # BL-1364 the-mechanical-share-of-a-turn-is-readable-01
  Scenario: a worked stage reports its mechanical share
    Given a stage whose turns include both mechanical and thinking intervals
    When the turn profile series is read
    Then that stage reports a mechanical share
    And the share reflects both kinds of interval

  # BL-1364 the-mechanical-share-of-a-turn-is-readable-02
  Scenario: a stage nobody worked is absent, not zero
    Given a stage with no classified turns in the window
    When the turn profile series is read
    Then that stage is absent from the series

  # BL-1364 the-mechanical-share-of-a-turn-is-readable-03
  Scenario: an unreadable transcript does not become a low share
    Given a transcript in the window cannot be read
    When the turn profile series is read
    Then the window is reported as incomplete
    And no stage from that window reports a share

  # BL-1364 the-mechanical-share-of-a-turn-is-readable-04
  Scenario Outline: every category the walker classifies survives into the series
    Given a stage whose turns are entirely <category>
    When the turn profile series is read
    Then that stage reports its whole share as <category>

    Examples:
      | category         |
      | git-mechanical   |
      | test-run         |
      | thinking-writing |
      | turn-overhead    |
