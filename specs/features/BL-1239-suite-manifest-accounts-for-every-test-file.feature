Feature: The Babashka suite runs because every test file is accounted for
  run_bb_suite.sh refuses to run while any file under swarmforge/scripts/test/
  is absent from suite-manifest.tsv. On main it names 39 such files, so the
  suite - which the engineering rules make the ONLY gate for Babashka and
  shell code, there being no mutation, CRAP or DRY tooling wired for that
  lane - cannot run at all, and QA cannot gate any change to it.

  Three of the manifest's own rows are malformed: their first column holds a
  ticket id rather than a filename, so they register nothing while looking
  like a registration. One of them was an attempt to register a file that is
  still reported missing.

  # BL-1239 suite-manifest-accounted-01
  Scenario: The suite runs
    Given every file under the test directory
    When the suite runner performs its inventory check
    Then no file is reported as absent from the manifest
    And the suite proceeds to run its tests

  # BL-1239 suite-manifest-accounted-02
  Scenario Outline: Every registered file sits in exactly one declared lane
    Given a manifest row in the <lane> lane
    Then the row names a file that exists under the test directory
    And the row carries <fields> for that lane

    Examples:
      | lane     | fields                    |
      | standing | an empty date and reason  |
      | excluded | both a date and a reason  |

  # BL-1239 suite-manifest-accounted-03
  Scenario: A row that names something other than a test file is rejected
    Given a manifest row whose first column is not a file under the test directory
    When the suite runner performs its inventory check
    Then the check fails and names that row
