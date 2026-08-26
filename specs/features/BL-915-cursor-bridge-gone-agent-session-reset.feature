Feature: the Cursor bridge starts a new agent when the stored agentId is gone

  # BL-915 stamp-off for landed hotfix ece61cbe63. The behaviour below is
  # ALREADY in production — this feature certifies it through the full gate
  # stack rather than re-specifying a rebuild. A stored Cursor SDK agentId the
  # cloud no longer has ("Agent agent-... not found") used to fail the prompt
  # outright; it is now classified as a session-reset fault like the other
  # three, so the bridge transparently starts a new agent.
  #
  # The sharp edge is PRECISION, not the happy path: the classifier is a
  # message-pattern match, so widening it risks swallowing unrelated faults
  # that must still fail fast. Scenarios 04 and 05 are the ones that matter.

  Background:
    Given the Cursor bridge has a stored agentId from an earlier session

  # BL-915 gone-agent-resets-and-prompt-succeeds-01
  Scenario: a gone stored agent is replaced instead of failing the prompt
    Given resuming the stored agent fails with "Agent agent-47f26e41 not found."
    When the operator sends a prompt through the bridge
    Then a new agent is created
    And the operator receives the new agent's reply rather than an error

  # BL-915 stored-agent-id-replaced-02
  Scenario: the reset replaces the stored agentId rather than leaving it stale
    Given resuming the stored agent fails with "Agent agent-47f26e41 not found."
    When the operator sends a prompt through the bridge
    Then the stored agentId is the newly created agent's id
    And the stored agentId is no longer the one the cloud rejected

  # BL-915 all-reset-faults-still-reset-03
  Scenario Outline: every fault classified as session-reset still resets
    Given resuming the stored agent fails with <fault>
    When the operator sends a prompt through the bridge
    Then a new agent is created

    Examples:
      | fault                    |
      | an active-run conflict   |
      | an authentication error  |
      | a connection failure     |
      | a gone-agent error       |

  # BL-915 quota-fault-fails-fast-without-reset-04
  Scenario: a rate-limit or quota fault still fails fast and does not reset
    Given resuming the stored agent fails with a rate-limit or quota error
    When the operator sends a prompt through the bridge
    Then no new agent is created
    And the operator is told the reason rather than being silently retried

  # BL-915 unrelated-not-found-is-not-a-gone-agent-05
  Scenario Outline: an unrelated "not found" message is not a gone agent
    Given resuming the stored agent fails with <unrelated message>
    When the operator sends a prompt through the bridge
    Then no new agent is created

    Examples:
      | unrelated message                    |
      | "Model gpt-5 not found."             |
      | "Repository not found."              |
      | "not found"                          |
