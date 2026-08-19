Feature: BL-958 control-plane loss is classified, recorded once, and owned
  A tmux server that disappears while support daemons stay up must be said
  out loud: status classifies the state as control-plane-missing instead of
  per-role DOWN derived from stale session metadata, a failed chase send
  persists exactly one structured incident, and the response policy resolves
  to one deterministic owner action. Live tmux restoration itself is the
  environmentally unsuitable boundary — it is verified by the ticket's
  qa_e2e_procedure, not by these scenarios; every step here drives testable
  modules over fixture state.

  Background:
    Given a swarm state fixture where the tmux socket file exists, the server probe reports no server running, and role session metadata is still present

  # BL-958 control-plane-loss-01
  Scenario: status classifies the loss as control-plane-missing instead of per-role DOWN
    When the status classifier evaluates the fixture
    Then the classification is control-plane-missing
    And no role is reported individually DOWN from the stale session metadata

  # BL-958 control-plane-loss-02
  Scenario Outline: a failed chase send persists exactly one structured incident
    Given <prior> control-plane incident is already recorded for this loss
    When the chase failure handler runs on a failed tmux send
    Then exactly one structured incident exists naming the socket path, the probe result, and the expected sessions

    Examples:
      | prior |
      | no    |
      | one   |

  # BL-958 control-plane-loss-03
  Scenario: the response policy resolves to exactly one deterministic owner action
    Given one control-plane incident is already recorded for this loss
    When the response policy evaluates the incident
    Then the decision names exactly one owning daemon
    And the decision is either a recovery action or a single escalation carrying the reason and the next action
