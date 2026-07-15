Feature: a redirect message in a role's Telegram topic interrupts that role with a verified nudge

  # Each of the eight swarm roles gets its OWN dedicated Telegram forum topic,
  # named for that role, alongside the existing per-ticket BL topics and the
  # standing Operator topic (BL-346, which this generalizes from one shared
  # channel to one-per-agent). BL-425 gives each topic TWO delivery modes; THIS
  # slice (slice 1) is the REDIRECT mode: an explicit, DISRUPTIVE message that
  # interrupts the addressed agent to change its course, delivered straight into
  # that role's live tmux pane as a verified nudge (the same confirmed-submit path
  # the extension's tiles and the chaser nudge use) through the extension host's
  # existing pane-inject seam on the swarm socket. The companion NON-DISRUPTIVE
  # QUESTION mode — a plain message queued to the agent as a mailbox note it
  # answers back into the topic, without pulling it off its task — is slice 2,
  # parked in the .feature.draft until built (BL-233). Two guards bound every
  # redirect: it acts only for the authorised principal, and only when sent in one
  # of the eight role topics (the same text in a BL topic, the Operator topic, or
  # any other topic does nothing, so those keep their existing behavior). Routing
  # is exact: role R's topic reaches role R's pane and no other role's.

  Background:
    Given a running swarm with a Telegram forum and the authorised human

  # BL-425 provision-role-topics-01
  Scenario: every swarm role has its own topic named for that role
    Given the eight swarm roles
    When the per-agent topics are ensured
    Then each role has its own forum topic named for that role and its topic id is recorded

  # BL-425 redirect-interrupts-addressed-pane-02
  Scenario: an authorised redirect message in a role's topic interrupts that role's pane
    Given the topic for the "<role>" role exists
    When the authorised human posts a redirect message in that topic
    Then the message is injected as an interrupting verified nudge into the "<role>" role's live pane

    Examples:
      | role        |
      | coder       |
      | QA          |
      | coordinator |

  # BL-425 redirect-routing-is-exact-03
  Scenario: a redirect reaches only the addressed role's pane, not another role's
    Given the topics for the "coder" and "cleaner" roles exist
    When the authorised human posts a redirect message in the "coder" topic
    Then the nudge is injected into the "coder" role's pane and the "cleaner" role's pane is left untouched

  # BL-425 guard-unauthorised-sender-04
  Scenario: an unauthorised sender's message in a role's topic does nothing
    Given the topic for the "coder" role exists
    When an unauthorised sender posts a message in that topic
    Then no nudge is injected into any pane

  # BL-425 guard-non-role-topic-05
  Scenario Outline: an authorised message in a non-role topic does nothing
    Given the authorised human posts a message in an ordinary "<topic-kind>" topic
    When the message is handled
    Then no nudge is injected into any pane and that topic keeps its existing behavior

    Examples:
      | topic-kind |
      | BL-ticket  |
      | Operator   |
