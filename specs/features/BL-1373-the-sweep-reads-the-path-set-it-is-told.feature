Feature: The sweep reads the path set it is told

  BL-631 scenario 07 states the contract: the QA-exclusive path set the
  babysitter sweep classifies against comes from BL-632's single source,
  `check_pipeline_code_on_main.sh --list-paths`, and never from a copy.

  That scenario fails. The BL-631 feature runs 16 of 17, deterministically,
  reproduced independently on a clean tree. Whatever the sweep classifies
  against, it is not answering to a path set the single source reports and it
  has not seen before.

  The cause is deliberately not asserted here. A grep of the two obvious files
  found no hardcoded copy, so the mechanism is not the one that would be
  guessed, and a spec that names the wrong cause sends the fix to the wrong
  place. Establish it, then fix it.

  Background:
    Given the QA-exclusive path set is reported by BL-632's single source

  # BL-1373 the-sweep-reads-the-path-set-it-is-told-01
  Scenario: a path the single source reports is classified
    Given the single source reports a path set the sweep has never seen
    And a commit touches only a path from that reported set
    When the babysitter sweep runs
    Then that commit fires a critical finding

  # BL-1373 the-sweep-reads-the-path-set-it-is-told-02
  Scenario: a path the single source does not report is not classified
    Given the single source reports a path set that excludes a path
    And a commit touches only that excluded path
    When the babysitter sweep runs
    Then that commit produces no finding
