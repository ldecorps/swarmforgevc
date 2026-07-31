Feature: a parcel reaches QA only with an acceptance contract that can actually run

  # BL-761: four SHIPPED tickets carry acceptance feature files whose steps no
  # handler has ever matched, so specs/pipeline/runtime.js throws on the first
  # scenario of each: BL-707 (0 of 6 scenarios runnable), BL-718 (0 of 6),
  # BL-706 (0 of 4) and BL-696 (3 of 8). Each landed looking green because the
  # acceptance contract was read by eye and never executed. BL-727 closes this
  # for the offline /pilot path by making the land itself run the contract;
  # nothing closes it for the ordinary pipeline, where the same substitution -
  # asserting coverage instead of running it - is available at every stage.
  # The pre-QA gate already arms on the documenter -> QA edge and already
  # refuses a parcel whose declared wiring is absent at the cited commit
  # (BL-531), so this is a third finding in that same gate, not a new one.

  Background:
    Given a ticket in backlog/active/ whose parcel commit is ready to forward to QA

  # BL-761 unrunnable-contract-refused-01
  Scenario Outline: a declared contract is judged by whether every step resolves
    Given the ticket's acceptance feature file <contract state>
    When the documenter forwards the parcel to QA
    Then the parcel is <outcome>

    Examples:
      | contract state                                          | outcome  |
      | has a registered handler for every step                 | forwarded |
      | has one scenario whose step matches no registered handler | held back |
      | has a step that matches no handler in its last scenario  | held back |

  # BL-761 every-outline-row-resolved-02
  Scenario: a Scenario Outline row that stops resolving after substitution holds the parcel back
    Given the ticket's acceptance feature file has a Scenario Outline whose steps resolve for the first example row
    And one later example row substitutes to a step no handler matches
    When the documenter forwards the parcel to QA
    Then the parcel is held back
    And the finding names the scenario, the example row, and the substituted step

  # BL-761 feature-scoped-handler-does-not-leak-03
  Scenario: a handler scoped to another feature does not count as coverage
    Given a step handler is registered scoped to a different feature's name
    And the ticket's acceptance feature file uses that same step text
    And no unscoped handler matches that step text
    When the documenter forwards the parcel to QA
    Then the parcel is held back

  # BL-761 judged-at-the-cited-commit-04
  Scenario: the contract is judged at the cited commit, not in the sender's working tree
    Given the cited commit registers a handler for every step of the feature file
    And the sender's working tree has since deleted that handler file
    When the documenter forwards the parcel to QA
    Then the parcel is forwarded

  # BL-761 absent-contract-fails-closed-05
  Scenario Outline: a contract that cannot be read at all fails closed
    Given the ticket's acceptance declaration <declaration>
    When the documenter forwards the parcel to QA
    Then the parcel is held back
    And the finding names the acceptance declaration as unreadable

    Examples:
      | declaration                                        |
      | is absent from the ticket                          |
      | is inline Gherkin instead of a feature file path   |
      | names a feature file that does not exist at the commit |

  # BL-761 gate-scope-06
  Scenario Outline: drafts and edges the gate does not own are not checked
    Given the ticket's acceptance feature file has a scenario whose step matches no registered handler
    When the sender forwards <parcel>
    Then the parcel is forwarded

    Examples:
      | parcel                                              |
      | a git_handoff addressed to cleaner                  |
      | a note addressed to QA                              |

  # BL-761 draft-companion-ignored-07
  Scenario: a not-yet-built slice parked in a .feature.draft companion is not checked
    Given the ticket's acceptance feature file has a registered handler for every step
    And a .feature.draft companion beside it holds a later slice's scenarios with no handlers
    When the documenter forwards the parcel to QA
    Then the parcel is forwarded

  # BL-761 registry-unreadable-fails-open-08
  Scenario: a step registry the gate cannot load warns and still forwards
    Given the step registry cannot be loaded at the cited commit
    When the documenter forwards the parcel to QA
    Then the parcel is forwarded
    And a warning names the check that could not run
