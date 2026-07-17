Feature: A count-only mutation-site helper reports per-file site counts and flags oversized changed files

# BL-485 (adopt upstream six-pack cleaner mutation-site SIZE gate; fresh design, not a port). This feature
# pins the observable behaviour of the COUNT-ONLY helper the cleaner runs before handoff: it reports how
# many mutation sites each changed file has, WITHOUT running the test-per-mutant loop, so the cleaner can
# split an oversized file before it reaches the hardener's mutation gate. FIRM and pinned here: counts come
# from out/-mapped compiled sources (Stryker's mutate scope is out/, never src/), the run is count-only, and
# the over-threshold verdict is measured against the CONFIGURED threshold. OPEN and deliberately NOT pinned
# here (human decides at prompt-amendment time, approval_context): the production threshold value, and
# whether cleaner.prompt makes the gate a HARD pre-handoff block or a SOFT advisory — that is role-prompt
# governance, not this helper's behaviour. The example thresholds below are illustrative, not the production
# value.

  # BL-485 mutation-site-size-gate-01
  Scenario: The helper reports a mutation-site count for each changed file
    Given changed compiled files with 12 and 45 mutation sites
    When the count-only helper runs on the changed files
    Then it reports a mutation-site count of 12 for the first file and 45 for the second

  # BL-485 mutation-site-size-gate-02
  Scenario: The count is taken from the compiled out/ file, not the TypeScript source
    Given a changed TypeScript source file whose compiled out/ file has 30 mutation sites
    When the count-only helper runs on the changed files
    Then it reports 30 mutation sites for that file from its compiled out/ mapping

  # BL-485 mutation-site-size-gate-03
  Scenario: The helper is count-only and never runs the test-per-mutant loop
    Given a changed compiled file with 20 mutation sites
    When the count-only helper runs on the changed files
    Then it does not execute any mutant against the test suite

  # BL-485 mutation-site-size-gate-04
  Scenario Outline: A changed file is flagged relative to the configured threshold
    Given the mutation-site size threshold is configured to <threshold> sites
    And a changed compiled file with <sites> mutation sites
    When the count-only helper runs on the changed files
    Then the file is reported as <verdict> the size gate

    Examples:
      | threshold | sites | verdict |
      | 100       | 150   | over    |
      | 100       | 60    | within  |
      | 100       | 100   | within  |
      | 50        | 60    | over    |
