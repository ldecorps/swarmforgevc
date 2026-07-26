# mutation-stamp: sha256=498b584d55ceb5553802533402370ea8e4ee2440ecfdfb9bf21431f5f1fae773
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-26T21:33:01.882625529Z","feature_name":"Topic make-top-priority within an epic","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-673-topic-make-top-priority.feature","background_hash":"6e1505547dd26b341193c820f81f9d1d84bdc5c25ca92f3d25b81b0be0f9f80b","implementation_hash":"unknown","scenarios":[{"index":4,"name":"Unresolvable dependency graphs refuse fail-closed","scenario_hash":"865d0f810842a69b6437d0eceeeb69563f7b692d22c9f3cd18e3431a1b3e40f8","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-26T21:33:01.882625529Z"}]}
# acceptance-mutation-manifest-end

Feature: Topic make-top-priority within an epic

  Background:
    Given a live backlog where epic "EA" has topics "A1,A2,A3" at priorities "1,4,6" and epic "EB" has topics "B1,B2" at priorities "2,5"
    And the bridge is serving the topic make-top route

  # BL-673 topic-make-top-priority-01
  Scenario: A dependency-free topic becomes the strict top of its own epic's live topics
    Given topic "A3" has no depends_on entries
    When topic make-top is applied to "A3" in epic "EA"
    Then "A3" ranks strictly better than every other live topic of epic "EA"
    And all applied writes land as one commit-integrity commit

  # BL-673 topic-make-top-priority-02
  Scenario: A within-epic move never reshuffles other epics' topics
    Given topic "A3" has no depends_on entries
    When topic make-top is applied to "A3" in epic "EA"
    Then the displayed order of "A1,A2,B1,B2" relative to each other is unchanged

  # BL-673 topic-make-top-priority-03
  Scenario: A better-ranked live dependency bounds the move below itself
    Given topic "A3" depends on live topic "A1" and "A1" ranks better than "A3"
    When topic make-top is applied to "A3" in epic "EA"
    Then "A3" lands immediately after "A1" in the displayed order
    And the response reason names "A1" as the bound

  # BL-673 topic-make-top-priority-04
  Scenario: A cross-epic live dependency ranked worse refuses the move
    Given topic "A3" depends on live topic "B2" and "B2" ranks worse than "A3"
    When topic make-top is applied to "A3" in epic "EA"
    Then the response is changed false and the reason names "B2"
    And no file is written and no commit is created

  # BL-673 topic-make-top-priority-05
  Scenario Outline: Unresolvable dependency graphs refuse fail-closed
    Given topic "A3" has <dependency-defect>
    When topic make-top is applied to "A3" in epic "EA"
    Then the response is changed false and the reason names the blocking ids
    And no file is written and no commit is created

    Examples:
      | dependency-defect                                  |
      | a cyclic depends_on chain back to itself           |
      | a depends_on id that resolves to no backlog item   |

  # BL-673 topic-make-top-priority-06
  Scenario: Done and active dependencies neither bound nor refuse
    Given topic "A3" depends only on a done item and an active item
    When topic make-top is applied to "A3" in epic "EA"
    Then "A3" ranks strictly better than every other live topic of epic "EA"

  # BL-673 topic-make-top-priority-07
  Scenario: A topic outside the named epic is refused without writes
    Given topic "B1" carries epic "EB"
    When topic make-top is applied to "B1" in epic "EA"
    Then the response is a not-found refusal and no file is written

  # BL-673 topic-make-top-priority-08
  Scenario: Re-applying to a topic already in its best permitted slot is a no-op with a reason
    Given topic make-top was already applied to "A3" in epic "EA"
    When topic make-top is applied to "A3" in epic "EA"
    Then the response is changed false with a human-readable reason
    And no file is written and no commit is created
