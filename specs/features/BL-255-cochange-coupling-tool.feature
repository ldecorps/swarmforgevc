Feature: a co-change coupling tool surfaces logical coupling from git history for the architect

  # Operator intake 2026-07-10 (via coordinator): make the architect's MANUAL
  # Feathers co-change check a real, repeatable tool. architect.prompt:32-37 tells
  # the architect to eyeball `git log` for files that repeatedly change together
  # (logical/temporal coupling the static import graph misses) — this makes that a
  # host-side analysis the architect runs and consumes, so hidden-coupling detection
  # isn't left to whether the architect remembered to hand-inspect history.
  #
  # Inspiration: Michael Feathers, "Using Repository Analysis to Find Single
  # Responsibility Violations" (delta-flora). Premise: things changed together are
  # usually one story, so coincident change reveals coupling static deps don't show.
  #
  # SCOPE DECISION (specifier's call, per intake): this ticket is the TEMPORAL
  # co-change lens only, at FILE level (the MVP; method-level is a later slice). The
  # complementary STATIC dependency-direction gate (import-direction / Dependency
  # Inversion) is a separate companion concern — not folded in here.
  #
  # The tool INFORMS; the architect still makes the pass/bounce judgment.

  Background:
    Given recorded git history of which files changed together in each commit, fed through an injectable seam

  # BL-255 ranks-cochangers-01
  Scenario: the tool ranks the files that most often co-change with the parcel's files
    Given a set of changed files under review
    When the co-change analysis runs
    Then it reports, for those files, the other files ranked by how often they co-changed

  # BL-255 threshold-flags-coupling-02
  Scenario: a pair at or above the tunable threshold is flagged; a pair below is not
    Given a minimum co-change frequency threshold
    When one file pair co-changes at or above that threshold and another below it
    Then the at-or-above pair is flagged as suspected logical coupling
    And the below-threshold pair is not flagged

  # BL-255 surfaces-import-invisible-coupling-03
  Scenario: co-change surfaces coupling that has no static import link
    Given two files that frequently change together but with no import between them
    When the co-change analysis runs
    Then they are reported as coupled

  # BL-255 window-is-tunable-04
  Scenario: the history window bounds which commits are counted
    Given a history window limited to the most recent commits
    When the co-change analysis runs
    Then commits outside that window are not counted toward co-change frequency

  # BL-255 deterministic-ordering-05
  Scenario: the report ordering is deterministic
    Given the same recorded history and the same changed files
    When the co-change analysis runs
    Then running it again on the same inputs produces the same ranked report
