Feature: the negotiation relay supervisor never runs two relay pollers at once

  # Same orphan-poller gap BL-403 closed for the front desk, on the OTHER
  # caller of the shared check-one! state machine: negotiation_relay_supervisor.bb
  # passes no kill-pid! adapter, so a restart never terminates the prior poll-loop
  # child, and two children long-poll Telegram getUpdates on the same bot token.

  Background:
    Given a negotiation relay supervisor managing a relay poll-loop child process

  # BL-411 negotiation-relay-kills-superseded-child-01
  Scenario: restarting a stalled relay terminates the prior pid before spawning the replacement
    Given a relay child pid judged unhealthy by the supervisor's liveness or heartbeat check
    When the supervisor acts on the restart decision
    Then it sends SIGTERM (and SIGKILL after a bounded grace timeout) to the prior pid
    And it confirms the prior pid is no longer alive before spawning the replacement

  # BL-411 negotiation-relay-kills-superseded-child-02
  Scenario: the replacement is not spawned while the prior pid is confirmed still alive
    Given a prior relay pid that has not yet exited after termination is requested
    When the supervisor checks whether it may spawn the replacement
    Then it waits rather than spawning a second live relay poller on the same bot token

  # BL-411 negotiation-relay-kills-superseded-child-03
  Scenario: status.json reflects exactly one live relay pid after a forced restart
    Given a completed forced restart of the relay child
    When the supervisor's status.json is read after the restart
    Then it records exactly one live relay pid, the replacement's
