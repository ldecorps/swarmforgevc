# mutation-stamp: sha256=3c827ca40401bd28090bea108f63b36814517585ccf16e9da744d82cb173dd1c
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T10:37:02.850917558Z","feature_name":"a redirect message in a role's Telegram topic interrupts that role with a verified nudge","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-425-per-agent-telegram-steering-topics.feature","background_hash":"ac8eec5f8d94be6a1cb7875464a4dc9833828171c38c9dcc5daee5fb829cb6d3","implementation_hash":"unknown","scenarios":[{"index":1,"name":"an authorised redirect message in a role's topic interrupts that role's pane","scenario_hash":"490f12a311bc6be7cf19d32e27027045aa6be66c9832b0357b9a2a119c7a2a8a","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-16T10:37:02.850917558Z"},{"index":4,"name":"an authorised message in a non-role topic does nothing","scenario_hash":"a55df0631966f0f04e872f3aeb676cc80e423755cce1c5b402cb4089b46c3380","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-16T10:35:42.860457771Z"}]}
# acceptance-mutation-manifest-end

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
