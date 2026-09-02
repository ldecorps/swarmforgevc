Feature: The handoff self-audit completes when required_stages reroutes the recipient
  BL-606's required_stages routing rewrites a forward git_handoff's recipient when
  the ticket declares a stage set that skips the drafted next stage. The Article 2.3
  two-call self-audit stores its challenge under the ROUTED recipient but looks the
  challenge up under the DRAFTED one, so a rerouted forward deletes its own standing
  challenge on every invocation and can never queue - the sender sees AUDIT_REQUIRED
  forever and has no way to send the parcel on.

  Background:
    Given required_stages routing is enabled

  # BL-1306 handoff-audit-reroute-01
  Scenario: The first invocation challenges and does not queue
    Given a forward git_handoff draft for a ticket whose required_stages skips the drafted recipient
    When the sender invokes the handoff helper once for that draft
    Then the helper reports AUDIT_REQUIRED
    And no handoff is queued

  # BL-1306 handoff-audit-reroute-02
  Scenario Outline: An identical second invocation queues the handoff
    Given a forward git_handoff draft for a ticket whose required_stages <declaration>
    And the sender has already invoked the handoff helper once for that draft
    When the sender invokes the handoff helper again with an identical draft
    Then the handoff is queued to <recipient>

    Examples:
      | declaration                 | recipient         |
      | skips the drafted recipient | the routed stage  |
      | keeps the drafted recipient | the drafted stage |

  # BL-1306 handoff-audit-reroute-03
  Scenario: A changed draft still invalidates the standing challenge
    Given a forward git_handoff draft for a ticket whose required_stages skips the drafted recipient
    And the sender has already invoked the handoff helper once for that draft
    When the sender edits the draft and invokes the handoff helper again
    Then the helper reports AUDIT_REQUIRED
    And no handoff is queued
