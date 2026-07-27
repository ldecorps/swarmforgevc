Feature: a grandfathered ticket keeps its allowlist entry when it changes backlog stage

  BL-684 retired a word and left a scan over every tracked file, plus an
  allowlist of files that legitimately still contain it. Several entries are
  backlog tickets grandfathered by filename. The comment above them says the
  grandfathering holds whichever stage directory currently holds the file;
  the implementation is a Set of exact full paths, so it does not.

  Unparking one ticket from hold to active broke the scan without changing a
  single byte of the file.

  Background:
    Given a residual-word scan with an allowlist of grandfathered files

  # BL-694 residual-allowlist-01
  Scenario Outline: a grandfathered ticket is excused in every stage directory
    Given a grandfathered ticket file allowlisted by its filename
    When the ticket sits in <stage>
    Then the scan reports no unexpected match

    Examples:
      | stage  |
      | active |
      | paused |
      | hold   |

  # BL-694 residual-allowlist-02
  Scenario: moving a grandfathered ticket between stages needs no test edit
    Given a grandfathered ticket file allowlisted by its filename
    When the ticket moves to another stage directory
    Then the scan reports no unexpected match

  # BL-694 residual-allowlist-03
  Scenario: a ticket that was never grandfathered is still reported
    Given a ticket file carrying the retired word that is not on the allowlist
    When the scan runs
    Then the scan reports it as an unexpected match

  # BL-694 residual-allowlist-04
  Scenario Outline: a matching basename elsewhere in the tree is not excused
    Given a grandfathered file allowlisted <how>
    And a different file with the same basename at <location>
    When the scan runs
    Then the scan reports the different file as an unexpected match

    Examples:
      | how             | location              |
      | by its filename | outside the backlog   |
      | by exact path   | elsewhere in the tree |

  # BL-694 residual-allowlist-05
  Scenario: an allowlist entry that matches nothing is not an error
    Given an allowlist entry naming a file that no longer exists
    When the scan runs
    Then the scan reports no unexpected match
