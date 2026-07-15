Feature: per-agent Telegram steering topics inject a nudge into the addressed agent's pane

  # Each of the eight swarm roles gets its OWN dedicated Telegram forum topic,
  # named for that role, alongside the existing per-ticket BL topics and the
  # standing Operator topic (BL-346, which this generalizes from one shared
  # steering channel to one-per-agent). An authorised human's message in role
  # R's steering topic is delivered straight into role R's LIVE tmux pane as a
  # verified nudge — exactly what typing into that role's tile in the extension
  # does — through the extension host's existing pane-inject seam on the swarm
  # socket. This slice is INBOUND steering only: the human drives the agent; the
  # scoped answer-back channel (the agent's reply to a steer flows back to its
  # topic, but not its ordinary activity) is a follow-up slice parked in the
  # companion .feature.draft. Two guards bound every steer: it acts only for the
  # authorised principal (an unauthorised sender's message injects nothing), and
  # only when sent in one of the eight role steering topics (the same text in a
  # BL topic, the Operator topic, or any other topic never becomes a steer, so
  # those topics keep their existing behavior). Routing is exact: a message in
  # role R's topic reaches role R's pane and no other role's.

  Background:
    Given a running swarm with a Telegram forum and the authorised human

  # BL-425 provision-role-steering-topics-01
  Scenario: every swarm role has its own steering topic named for that role
    Given the eight swarm roles
    When the per-agent steering topics are ensured
    Then each role has its own forum topic named for that role and its topic id is recorded

  # BL-425 steer-inject-into-addressed-pane-02
  Scenario: an authorised message in a role's steering topic is injected into that role's pane
    Given the steering topic for the "<role>" role exists
    When the authorised human posts a steering message in that topic
    Then the message is injected as a verified nudge into the "<role>" role's live pane

    Examples:
      | role        |
      | coder       |
      | QA          |
      | coordinator |

  # BL-425 steer-routing-is-exact-03
  Scenario: a steer reaches only the addressed role's pane, not another role's
    Given the steering topics for the "coder" and "cleaner" roles exist
    When the authorised human posts a steering message in the "coder" topic
    Then the nudge is injected into the "coder" role's pane and the "cleaner" role's pane is left untouched

  # BL-425 steer-guard-unauthorised-sender-04
  Scenario: an unauthorised sender's message in a steering topic injects nothing
    Given the steering topic for the "coder" role exists
    When an unauthorised sender posts a message in that topic
    Then no nudge is injected into any pane

  # BL-425 steer-guard-non-steering-topic-05
  Scenario Outline: an authorised message in a non-steering topic is not a steer
    Given the authorised human posts a message in an ordinary "<topic-kind>" topic
    When the message is handled
    Then no nudge is injected into any pane and that topic keeps its existing behavior

    Examples:
      | topic-kind |
      | BL-ticket  |
      | Operator   |
