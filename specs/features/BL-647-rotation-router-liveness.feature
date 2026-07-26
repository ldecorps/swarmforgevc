Feature: rotation-router liveness never blames dormant roles

  Under a `config rotation router` pack exactly two tmux sessions exist by
  design — the coordinator and the one resident pane rotated to the active
  role — yet the operator's liveness producer checked every roles.tsv row's
  own session name and fired six permanent AGENT_EXITED events every tick,
  525 times against the real operator log. The producer now receives the
  rotation mode resolved from the conf: a dormant role (never expected to
  hold a session this tick) produces no event, the active role is checked
  against the resident session, the coordinator is always checked against
  its own session, and every non-router pack keeps today's behaviour
  unchanged. The rotation mode is read from the conf, never inferred from
  the live-session count — a real multi-agent pack that has just lost six
  agents must still scream. The mid-rotation race is closed by construction:
  rotation re-execs the resident pane in place so its tmux session never
  dies during a rotation, and every non-coordinator role is checked against
  that same resident session, so a stale active-role marker can change only
  which subject a real death would name, never whether a live resident
  counts as dead.

  Background:
    Given a roles fixture with the live system's eight roles.tsv rows

  # BL-647 rotation-router-liveness-01
  Scenario: coordinator plus resident live under a router pack reports no dead agents
    Given the conf declares rotation mode router
    And the live tmux sessions are swarmforge-coder and swarmforge-coordinator
    And the active role marker names coder
    When the dead-agent liveness sweep runs
    Then it reports no AGENT_EXITED events

  # BL-647 rotation-router-liveness-02
  Scenario Outline: a dead resident fires exactly one event naming the active role
    Given the conf declares rotation mode router
    And the active role marker names <role>
    And the coordinator session is live but the resident session is not
    When the dead-agent liveness sweep runs
    Then it reports exactly one AGENT_EXITED event
    And that event names <role> as its subject

    Examples:
      | role      |
      | coder     |
      | architect |

  # BL-647 rotation-router-liveness-03
  Scenario: a dead coordinator under a router pack fires exactly one coordinator event
    Given the conf declares rotation mode router
    And the resident session is live but the coordinator session is not
    When the dead-agent liveness sweep runs
    Then it reports exactly one AGENT_EXITED event
    And that event names coordinator as its subject

  # BL-647 rotation-router-liveness-04
  Scenario: a non-router pack keeps the pre-fix behaviour for every absent role
    Given the conf declares no rotation mode
    And only the coordinator session is live
    When the dead-agent liveness sweep runs
    Then it reports one AGENT_EXITED event for each of the seven non-coordinator roles

  # BL-647 rotation-router-liveness-05
  Scenario: two live sessions alone never imply router mode
    Given the conf declares no rotation mode
    And the live tmux sessions are swarmforge-coder and swarmforge-coordinator
    When the dead-agent liveness sweep runs
    Then it reports one AGENT_EXITED event for each of the six sessionless roles

  # BL-647 rotation-router-liveness-06
  Scenario: a stale active-role marker during rotation emits nothing while the resident lives
    Given the conf declares rotation mode router
    And the live tmux sessions are swarmforge-coder and swarmforge-coordinator
    And the active role marker still names the role rotated away from
    When the dead-agent liveness sweep runs
    Then it reports no AGENT_EXITED events
