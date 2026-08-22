Feature: promotion orthogonality advises on epic overlap instead of blocking on it

  # BL-854: promotion_gates_lib.bb uses the mandatory `epic:` theme tag as a
  # stand-in for file scope, because no ticket field declares one. The buckets
  # are large — 76 of 204 paused tickets share `swarm-reliability` — so one
  # active defect refuses its whole theme. Measured 2026-08-08: 112 of 204
  # paused tickets refused on this gate alone, and backlog/active/ already
  # holds two tickets sharing an epic because the coordinator overrode the
  # gate by hand (3fbe05e9), having compared the tickets' declared file paths
  # and found zero real overlap. The automated layer can raise the question;
  # it has no data to answer it, so it advises and the coordinator rules.

  Background:
    Given an active ticket BL-900 in epic swarm-reliability

  # BL-854 epic-overlap-advises-and-allows-01
  Scenario: a candidate sharing an active epic is allowed, with an advisory
    Given a paused candidate in epic swarm-reliability
    When the promotion gates evaluate that candidate
    Then the verdict is allow
    And an orthogonality advisory is raised
    And the advisory names BL-900

  # BL-854 advisory-names-every-overlapping-ticket-02
  Scenario: the advisory names every active ticket sharing the epic
    Given an active ticket BL-901 in epic swarm-reliability
    And a paused candidate in epic swarm-reliability
    When the promotion gates evaluate that candidate
    Then the advisory names BL-900 and BL-901

  # BL-854 no-overlap-raises-no-advisory-03
  Scenario: a candidate whose epic is not active is allowed silently
    Given a paused candidate in epic bubble-control
    When the promotion gates evaluate that candidate
    Then the verdict is allow
    And no orthogonality advisory is raised

  # BL-854 advisory-never-changes-the-selection-04
  Scenario: an advisory never changes which candidate is selected
    Given a paused candidate in epic swarm-reliability that is the correctly-laned next pick under Article 3.2.4
    And a lower-laned paused candidate in epic bubble-control
    When promote_and_route selects the next candidate
    Then the swarm-reliability candidate is selected
    And its advisory is reported once for the promoted ticket

  # BL-854 every-other-gate-still-refuses-05
  Scenario Outline: every other promotion gate refuses exactly as it does today
    Given a paused candidate blocked by the <gate> gate
    When the promotion gates evaluate that candidate
    Then the verdict is refuse
    And the refusal names the <gate> gate as the reason

    Examples:
      | gate                     |
      | human_approval           |
      | active_backlog_max_depth |
      | hold marker              |

  # BL-854 machine-contract-is-unchanged-06
  Scenario: the advisory does not alter the verdict a caller parses
    Given a paused candidate in epic swarm-reliability
    When a caller reads the evaluation verdict
    Then the verdict it reads is the same one it reads for a candidate with no epic overlap
    And the advisory reaches the operator on a separate stream
