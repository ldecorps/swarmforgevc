# mutation-stamp: sha256=dd9a944f089641abc91c52b16c59eaccd716eae40e4298c7d953a8600facf6ed
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-26T21:32:57.473944299Z","feature_name":"Epic make-top-priority button","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-672-epic-make-top-priority.feature","background_hash":"e59a0b8b0c4dcb30eb8a4bce32132ec5286dd12e4667b50166fb4de5b34f344b","implementation_hash":"unknown","scenarios":[{"index":4,"name":"Unresolvable dependencies refuse fail-closed with named blockers","scenario_hash":"d763081aad2beda5eecc77fc53372e1489284ee3aa56928aa5d27ed34e990e39","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-26T21:32:57.473944299Z"}]}
# acceptance-mutation-manifest-end

Feature: Epic make-top-priority button

  Background:
    Given a live backlog with epics "E1,E2,E3" at priorities "0,0,2" and topics "T1,T2" at priorities "0,5"
    And the bridge epic reorder screen is being served

  # BL-672 epic-make-top-priority-01
  Scenario: Tapping make-top on a dependency-free epic makes it the unique top of the live backlog
    Given epic "E3" has no depends_on entries
    When make-top is applied to "E3"
    Then "E3" ranks strictly better than every other live epic and every live paused or hold topic
    And no other live item shares "E3"'s new priority value
    And all applied writes land as one commit-integrity commit

  # BL-672 epic-make-top-priority-02
  Scenario: Displaced items keep their relative order through the floor tie-run
    Given epic "E3" has no depends_on entries
    When make-top is applied to "E3"
    Then the displayed order of "E1,E2,T1,T2" relative to each other is unchanged

  # BL-672 epic-make-top-priority-03
  Scenario: Re-applying to an already-top epic is a committed no-op with a reason
    Given make-top was already applied to "E3"
    When make-top is applied to "E3"
    Then the response is changed false with a human-readable reason
    And no file is written and no commit is created

  # BL-672 epic-make-top-priority-04
  Scenario: A live better-ranked dependency bounds the move instead of being outranked
    Given epic "E3" depends on live epic "E1" and "E1" ranks better than "E3"
    When make-top is applied to "E3"
    Then "E3" lands immediately after "E1" in the displayed order
    And the response reason names "E1" as the bound

  # BL-672 epic-make-top-priority-05
  Scenario Outline: Unresolvable dependencies refuse fail-closed with named blockers
    Given epic "E3" has <dependency-defect>
    When make-top is applied to "E3"
    Then the response is changed false and the reason names the blocking ids
    And no file is written and no commit is created

    Examples:
      | dependency-defect                                      |
      | a live dependency currently ranked worse than "E3"     |
      | a cyclic depends_on chain back to itself               |
      | a depends_on id that resolves to no backlog item       |

  # BL-672 epic-make-top-priority-06
  Scenario: Done and active dependencies do not bound or refuse the move
    Given epic "E3" depends only on a done item and an active item
    When make-top is applied to "E3"
    Then "E3" ranks strictly better than every other live epic and every live paused or hold topic

  # BL-672 epic-make-top-priority-07
  Scenario: The make-top route requires control auth
    Given a request without a valid control step-up token
    When make-top is applied to "E3"
    Then the response is an auth failure and no file is written
