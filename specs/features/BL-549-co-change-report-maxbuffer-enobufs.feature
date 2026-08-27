Feature: Co-change coupling report does not silently swallow large-history overflow

  Background:
    Given a git repository whose full-history name-status output exceeds execFileSync's default 1 MiB buffer

  # BL-549 co-change-maxbuffer-01
  Scenario: a whole-repo history over the default buffer cap still yields co-changers
    Given a file with real co-change history in a repository whose full name-status log exceeds 1 MiB
    When the co-change report runs for that file
    Then the report lists that file's co-changers with their co-change counts
    And it does not report "no co-changers found"

  # BL-549 co-change-maxbuffer-02
  Scenario: an oversized git-log read that still overflows an explicit buffer surfaces the error
    Given a git-log read that exceeds even an explicit maxBuffer configured on the adapter
    When the co-change report runs
    Then the tool surfaces a diagnostic identifying the overflow
    And it does not silently render an empty co-changers result
