Feature: BL-1275 a refused commit leaves the suite output behind
  The property-suite guard runs the suite into a temporary file, echoes it to
  stderr, and deletes it. On a refusal the only surviving copy is terminal
  scrollback, and the refusal names no path - so whether a red can later be
  adjudicated as a regression, a known flake, or a new mechanism depends on
  whether someone happened to keep the output. Twice that has decided an
  investigation: a retained 53KB log split one vague report into four distinct
  mechanisms on 2026-08-22, and a swept log left a red unadjudicated on
  2026-08-29. Four different files refused five commits in one shift, so a
  single fixed-name log would keep only the last and lose the interesting one.

  Background:
    Given the property-suite guard is driven with an injected suite command

  # BL-1275 refusal-evidence-survives-01
  Scenario: a refusal retains the suite output and says where it is
    Given the injected suite fails in a file that is not allowlisted
    When the guard runs
    Then the commit is refused
    And the refusal names a path to the retained output
    And the file at that path contains the injected suite's failing line

  # BL-1275 refusal-evidence-survives-02
  Scenario: successive refusals do not overwrite each other
    Given the injected suite fails three times with different output
    When the guard runs once for each failure
    Then all three retained outputs are readable afterwards

  # BL-1275 refusal-evidence-survives-03
  Scenario: a green run retains nothing
    Given the injected suite passes
    When the guard runs
    Then the commit is allowed
    And no output is retained

  # BL-1275 refusal-evidence-survives-04
  Scenario: retention never touches the tracked tree and never grows without limit
    Given the injected suite fails more times than the retention bound allows
    When the guard runs once for each failure
    Then the tracked working tree is unchanged from before the first run
    And only the most recent outputs within the retention bound are kept
