# mutation-stamp: sha256=9014ee1ff7149985f21fcf95a4a47e3cc2461732f2bd9c2339b0b4b01c5c1e59
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-18T11:49:38.490059Z","feature_name":"an unreadable acceptance declaration is caught where it is written","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-922-unreadable-acceptance-declaration-caught-at-mint.feature","background_hash":"72e6b61542e79cffc4f426fca0f4d5e3e993cdff6900401cb5814b1fd52613f0","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a block scalar hiding a feature-file pointer is refused","scenario_hash":"7a9b82c18fe05397520943ed2578415e03d124ff3dc653aa51f8ff52161155e5","mutation_count":5,"result":{"Total":5,"Killed":5,"Survived":0,"Errors":0},"tested_at":"2026-08-18T11:49:38.490059Z"},{"index":1,"name":"every other acceptance shape is outside this check","scenario_hash":"c8f25e2949239a044c84785ac2a7596a7d4665c130c9e61bbe0b57f3a5f447e1","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-18T11:49:38.490059Z"}]}
# acceptance-mutation-manifest-end

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
