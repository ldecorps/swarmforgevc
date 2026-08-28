Feature: the property-suite allowlist gate recognises every allowlisted red, not just a lone one

  # BL-1234 (epic swarm-reliability). BL-1175 lets a commit through when every
  # red property test is on the standing allowlist. The verdict is correct for
  # exactly one failing file and wrong for two or more, so the feature has
  # never worked for the case it was built for.

  Background:
    Given a property suite run that failed
    And a standing-red allowlist naming files by path

  # BL-1234 every-allowlisted-red-is-recognised-01
  Scenario Outline: a run whose failures are all allowlisted is allowed, whatever the count
    Given <failing_count> failing files, every one of them named in the allowlist
    When the property-suite guard evaluates the run
    Then the commit is allowed

    Examples:
      | failing_count |
      | one           |
      | two           |
      | five          |

  # BL-1234 unlisted-file-is-named-alone-02
  Scenario: an unlisted file among allowlisted ones refuses, and only it is named
    Given three failing files, two named in the allowlist and one not
    When the property-suite guard evaluates the run
    Then the commit is refused
    And the refusal names the unlisted file and no other path
