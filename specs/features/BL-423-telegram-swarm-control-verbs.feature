Feature: guarded Telegram control verbs stop and restart the swarm from the phone behind a confirmation gate

  # The authorised human drives a clean swarm stop and a durable relaunch from a
  # dedicated Telegram control topic, without opening the VS Code extension. The
  # verbs reuse the sanctioned bounce path (remote_bounce sentinel + phased
  # bounce-ack), executed by the owning-context executor — never a naive external
  # respawn. Every verb is guarded to the authorised human, scoped to the control
  # topic, and gated behind an explicit confirmation so a single mis-tap cannot
  # tear the swarm down.

  Background:
    Given a dedicated guarded Telegram control topic and the authorised human

  # BL-423 control-confirm-required-01
  Scenario Outline: an authorised control verb posts a confirmation and executes nothing yet
    Given the authorised human sends the "<verb>" control verb in the control topic
    When the verb is handled
    Then a confirmation prompt is posted and the swarm is left untouched

    Examples:
      | verb    |
      | stop    |
      | restart |

  # BL-423 control-confirm-cancel-02
  Scenario Outline: cancelling a control verb's confirmation leaves the swarm running
    Given the authorised human has a pending "<verb>" confirmation in the control topic
    When the human cancels the confirmation
    Then the swarm is left running and nothing is executed

    Examples:
      | verb    |
      | stop    |
      | restart |

  # BL-423 control-guard-unauthorised-03
  Scenario: an unauthorised sender's control verb is refused
    Given an unauthorised sender posts a stop verb in the control topic
    When the verb is handled
    Then it is refused and the swarm is not torn down

  # BL-423 control-guard-topic-04
  Scenario: a control verb outside the control topic is ignored
    Given the authorised human posts a restart verb in an ordinary non-control topic
    When the verb is handled
    Then it is ignored and the swarm is not restarted

  # BL-423 control-stop-clean-05
  Scenario: a confirmed stop tears the swarm down with no orphaned processes
    Given the authorised human has confirmed a stop
    When the teardown runs
    Then every swarm-owned process it started is reaped, leaving no orphaned tmux windows or vitest workers

  # BL-423 control-restart-phases-06
  Scenario: a confirmed restart relaunches from the owning context and reports each phase
    Given the authorised human has confirmed a restart
    When the relaunch runs through the owning-context executor
    Then each bounce phase from draining through done is reported back to the control topic

  # BL-423 control-restart-failed-bootstrap-07
  Scenario: a restart that leaves windows without bootstrapped agents is reported failed
    Given a confirmed restart whose relaunch creates windows but no agent bootstraps into them
    When the relaunch outcome is evaluated
    Then it is reported as failed rather than done
