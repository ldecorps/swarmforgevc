# mutation-stamp: sha256=518b391aa4ffed5e155a0b198085f7695e8ed32e49941fe904439c6c22b9fbf4
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-10T15:20:32.389857Z","feature_name":"an undeliverable role question never leaves the asking role wedged","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/GH-26-undeliverable-role-question-clears-marker.feature","background_hash":"d631a6e5d1dc9e1d7344c79cc21ed38c88bc623d1924e721277a77175238d2c1","implementation_hash":"unknown","scenarios":[{"index":0,"name":"an undeliverable question rewrites the awaiting marker instead of dropping silently","scenario_hash":"d36c1620e5ef74c6cc698e43cec776a3727e973dfcd70bbcf94844cec4bcc82e","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-10T15:20:32.389857Z"}]}
# acceptance-mutation-manifest-end

Feature: an undeliverable role question never leaves the asking role wedged

  # GH-26: deliverRoleQuestion silently drops a question when the role has
  # no topic-map entry, but role_ask.bb's role-awaiting marker is never
  # cleared, wedging the role in already-pending forever. Undeliverable
  # must rewrite the marker with state undeliverable and surface it.

  Background:
    Given a role-awaiting marker exists for role "specifier"

  # GH-26 undeliverable-role-question-clears-marker-01
  Scenario Outline: an undeliverable question rewrites the awaiting marker instead of dropping silently
    Given the role topic lookup is <lookup>
    When the reply relay processes the specifier role question record
    Then the awaiting marker is rewritten with state undeliverable
    And the record is acked exactly once

    Examples:
      | lookup                              |
      | missing from role-topic-map.json    |
      | failing because the map is unreadable |

  # GH-26 undeliverable-role-question-clears-marker-02
  Scenario: an undeliverable-state marker no longer blocks the next ask
    Given the awaiting marker for role "specifier" carries state undeliverable
    When role_ask.bb is invoked for role "specifier"
    Then the ask is accepted
    And the marker is overwritten as the new pending question

  # GH-26 undeliverable-role-question-clears-marker-03
  Scenario: the undeliverable drop is surfaced in status.json
    Given the role topic lookup is missing from role-topic-map.json
    When the reply relay processes the specifier role question record
    Then status.json reports an undeliverable role question for "specifier"

  # GH-26 undeliverable-role-question-clears-marker-04
  Scenario: a deliverable question keeps the pending marker until answered
    Given role "specifier" has a topic in role-topic-map.json
    When the reply relay processes the specifier role question record
    Then the question is posted to the specifier role topic
    And the awaiting marker remains pending
