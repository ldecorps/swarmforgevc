# mutation-stamp: sha256=bdbe55ab9396506c74ccde9be03bfb7b4c37638dc34f7b6490ab2ff0d8c7ca49
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-07T12:19:22.921433Z","feature_name":"The coordinator raises a clarifying question through the shared role-ask path","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-773-coordinator-asks-through-the-role-ask-path.feature","background_hash":"32805050e34b4d211f34b034d10e28a6c969a6aa53a55f00fa3f7533df6fe111","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a coordinator question is published to the coordinator's own topic","scenario_hash":"73be7e1d958573dc8fd90a5b59237272d41517e3cb38ac86a06cbcd5a8000c4d","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-07T12:19:22.921433Z"},{"index":3,"name":"the one-pending guard is per role, not global","scenario_hash":"e852534f2f9ba86f585a763cf5fd8629f126bdc3d92b4eff12e330b22911b551","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-07T12:19:22.921433Z"}]}
# acceptance-mutation-manifest-end

Feature: The coordinator raises a clarifying question through the shared role-ask path
  role_ask.bb is role-generic by construction but is wired into one role prompt
  only, the specifier's. The coordinator has no ask path, so when it needs an
  answer its question appears only on whatever surface happens to be attached —
  cloud remote control on 2026-07-30, which nobody was watching — and the
  coordinator blocks. This slice gives the coordinator the same path the
  specifier already uses: ask, end the turn, be woken by the answer.
  Source: backlog/INTAKE-coordinator-questions-surface-via-telegram-and-bubble.md.

  Background:
    Given the swarm is running and the coordinator holds a decision it cannot resolve alone

  # BL-773 coordinator-role-ask-01
  Scenario Outline: a coordinator question is published to the coordinator's own topic
    When the coordinator raises an <question-kind> clarifying question
    Then the pending-question record for role coordinator names that question
    And it is published to the coordinator's own topic offering <answer-affordance>

    Examples:
      | question-kind | answer-affordance              |
      | optioned      | one tappable button per option |
      | open          | a free-text reply prompt       |

  # BL-773 coordinator-role-ask-02
  Scenario: asking does not block the coordinator
    When the coordinator raises an open clarifying question
    Then the coordinator ends its turn without waiting for an answer
    And it does not poll for the answer

  # BL-773 coordinator-role-ask-03
  Scenario: the answer comes back through the existing canonical channel
    Given the coordinator already has a clarifying question pending
    When the human answers it
    Then the answer is recorded for role coordinator
    And the coordinator receives a note telling it the answer is ready
    And no second answer channel is written

  # BL-773 coordinator-role-ask-04
  Scenario Outline: the one-pending guard is per role, not global
    Given <holder> already has a clarifying question pending
    When the coordinator raises an open clarifying question
    Then the coordinator's question is <outcome>
    And the question pending for <holder> is untouched

    Examples:
      | holder          | outcome                    |
      | the specifier   | accepted                   |
      | the coordinator | refused as already-pending |
