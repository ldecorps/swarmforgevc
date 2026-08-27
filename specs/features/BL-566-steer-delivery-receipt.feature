Feature: steering a role topic reports whether the steer reached a pane

  # BL-425 slice 1 injects a role-topic message into that role's live tmux pane
  # as a verified nudge, and its pane adapter deliberately never throws - so a
  # steer that never landed was swallowed into a stderr line the human never
  # sees. On a mono-router that is the NORMAL case for six of the eight roles:
  # only coordinator and coder hold live panes, the rest are dormant rotation
  # targets, so six steering topics were silent no-ops indistinguishable from
  # the two that worked. This slice posts a one-line receipt back into the SAME
  # topic the steer arrived in. "no live pane" stays a DIFFERENT message from a
  # failed send on purpose - on a mono-router the first is expected and the
  # second is a real fault, and one shared message would train the human to
  # ignore both. An unauthorised sender gets no receipt at all: the refuse guard
  # returns before any redirect is attempted, and a receipt would confirm to
  # them that the topic is live and steerable. Relaying the agent's own reply
  # back into the topic is explicitly NOT this slice.

  Background:
    Given a live swarm whose role steering topics are already bound

  # BL-566 receipt-delivered-01
  Scenario: a steer that reaches the role's pane is confirmed in the same topic
    Given the "coordinator" role has a live pane
    When the authorised human steers "coordinator" with "merge main before the next dispatch"
    Then the receipt posted into the "coordinator" topic confirms the steer was delivered

  # BL-566 receipt-no-pane-02
  Scenario Outline: steering a dormant role reports the missing pane instead of vanishing
    Given the "<role>" role has no live pane
    When the authorised human steers "<role>" with "re-read the spec"
    Then the receipt posted into the "<role>" topic says that role has no live pane

    Examples:
      | role       |
      | specifier  |
      | architect  |

  # BL-566 receipt-send-failure-03
  Scenario: a pane that exists but does not accept the nudge reports the reason
    Given the "coder" role has a live pane that rejects the nudge with "pane busy"
    When the authorised human steers "coder" with "stop and re-read the ticket"
    Then the receipt posted into the "coder" topic reports the failure reason "pane busy"

  # BL-566 receipt-names-the-role-04
  Scenario: every receipt names the role it is reporting on
    Given the "QA" role has a live pane
    When the authorised human steers "QA" with "re-run the acceptance suite"
    Then the receipt posted into the "QA" topic names the role "QA"

  # BL-566 guard-unauthorised-gets-no-receipt-05
  Scenario: an unauthorised sender is refused and told nothing
    Given the "coordinator" role has a live pane
    When an unauthorised sender posts "do a thing" in the "coordinator" topic
    Then no steer is attempted and no receipt is posted anywhere

  # BL-566 degrades-when-unwired-06
  Scenario: steering still works, silently, where receipts are not wired
    Given the "coordinator" role has a live pane
    And the receipt channel is not wired
    When the authorised human steers "coordinator" with "merge main before the next dispatch"
    Then the steer still reaches the "coordinator" pane and no receipt is posted anywhere

  # BL-566 guard-non-role-topic-07
  Scenario: a message in a non-role topic produces no receipt
    When the authorised human posts "just chatting" in a topic bound to no role
    Then no steer is attempted and no receipt is posted anywhere
