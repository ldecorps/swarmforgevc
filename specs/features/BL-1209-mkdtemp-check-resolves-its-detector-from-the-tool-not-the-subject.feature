Feature: BL-1209 the mkdtemp convention check resolves its own detector from the tool, not from the root it is scanning

  assessPilotMkdtempConvention takes a repoRoot - the root whose touched files
  it is asked to scan - and uses it for two different jobs. Reading the
  subject's files is its real job. Loading the raw-mkdtemp detector is not:
  that detector is a SwarmForge-VC artifact, and requiring it from
  <repoRoot>/extension/test/helpers/rawMkdtempGuard means the check can only
  ever run against the one repo that happens to contain it.

  Against any other root it raises MODULE_NOT_FOUND, and it does so eagerly -
  the detector is loaded at the top of the function, before a single path is
  examined, so a call with nothing in scope to scan fails just as hard as one
  with work to do.

  The cost is paid in testability. The only test that drives the real function
  points it at the live repository root and writes a scratch file into the
  collected test tree to give it something to find, because a fixture root
  cannot work. That file matches the suite's own discovery glob, so a run
  killed before its cleanup leaves it behind for the next run to collect.

  Background:
    Given a subject root whose touched files the check is asked to scan

  # BL-1209 mkdtemp-check-resolves-its-detector-from-the-tool-not-the-subject-01
  Scenario Outline: a touched test file is scanned against a subject root that is not the tool's own repository
    Given the subject root does not contain the tool's detector
    And a touched test file in the subject root <file content>
    When the convention check runs
    Then the check completes without error
    And <expectation>

    Examples:
      | file content                       | expectation                                     |
      | contains a raw temp-directory call | the raw call is reported with its file and line |
      | uses the shared helper instead     | no raw call is reported                         |

  # BL-1209 mkdtemp-check-resolves-its-detector-from-the-tool-not-the-subject-02
  Scenario: nothing in scope is a successful empty result, never an error
    Given none of the touched paths are test files the check scans
    When the convention check runs
    Then the check completes without error
    And it reports that no files were scanned

  # BL-1209 mkdtemp-check-resolves-its-detector-from-the-tool-not-the-subject-03
  Scenario: the check's own tests leave the live test tree untouched
    Given the set of files in the tool's own collected test tree is recorded
    When the convention check's test suite runs to completion
    Then the set of files in that tree is unchanged
