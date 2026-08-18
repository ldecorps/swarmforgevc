Feature: an unreadable acceptance declaration is caught where it is written

  A ticket's acceptance: field is read as that LINE's own tail, never the
  indented body beneath it. A YAML block scalar therefore collapses to the bare
  indicator, and the pre-QA gates reject it at the documenter->QA hop - after
  five stages of work have already been spent. The specifier's own hygiene gate,
  and the repo-wide audit that shares its library, refuse the shape at the moment
  it is authored instead.

  Background:
    Given a backlog ticket YAML carrying an id and a type

  # BL-922 unreadable-acceptance-declaration-caught-at-mint-01
  Scenario Outline: a block scalar hiding a feature-file pointer is refused
    Given the ticket's acceptance field uses the block-scalar indicator "<indicator>"
    And the block body names a feature file under specs/features
    When the specifier hygiene gate runs on the ticket
    Then the gate reports an unreadable-acceptance violation naming the ticket id and its path
    And the gate exits non-zero

    Examples:
      | indicator  |
      | pipe       |
      | pipe-strip |
      | pipe-keep  |
      | fold       |
      | fold-strip |

  # BL-922 unreadable-acceptance-declaration-caught-at-mint-02
  Scenario Outline: every other acceptance shape is outside this check
    Given the ticket's acceptance field has the shape "<shape>"
    When the specifier hygiene gate runs on the ticket
    Then the gate reports no unreadable-acceptance violation
    And the gate exits zero

    Examples:
      | shape                               |
      | single-line-pointer                 |
      | block-scalar-naming-no-feature-file |
      | absent                              |

  # BL-922 unreadable-acceptance-declaration-caught-at-mint-03
  Scenario: the gate reports every violating ticket in one run, not just the first
    Given two tickets whose acceptance fields both hide a feature-file pointer behind a block scalar
    When the specifier hygiene gate runs on both tickets in one invocation
    Then the gate reports an unreadable-acceptance violation naming the ticket id and its path for each of the two
    And the gate exits non-zero

  # BL-922 unreadable-acceptance-declaration-caught-at-mint-04
  Scenario: the live backlog carries no unreadable acceptance declaration
    Given the repo-wide backlog audit
    When it scans every ticket in backlog/active and backlog/paused
    Then it reports zero unreadable-acceptance violations
