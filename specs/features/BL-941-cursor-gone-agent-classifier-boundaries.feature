Feature: the Cursor gone-agent classifier holds its boundaries

  # BL-941 runs the mutation and CRAP gates BL-915 could not — the file was
  # inside its BL-149 cooldown window and the host was above the load
  # threshold. The scenarios below pre-kill the three mutants that regex
  # predicate invites: a loosened trailing anchor, a dropped case-insensitivity
  # flag, and an added start/end anchor.
  #
  # These scenarios rule ONLY on surface formatting. They deliberately do not
  # decide whether a REWORDED vendor message ("Agent ID agent-x not found",
  # "Agent agent-x was not found") should reset — widening the pattern is
  # BL-915's declared out-of-scope and belongs to its own ticket.
  #
  # Step handlers are NOT shared with BL-915: its registrations are scoped to
  # its own feature name, so this feature needs its own handler file.

  Background:
    Given the Cursor bridge has a stored agentId from an earlier session

  # BL-941 formatting-variants-still-reset-01
  Scenario Outline: the stored agent is gone whatever the surface formatting
    Given resuming the stored agent fails with <message>
    When the operator sends a prompt through the bridge
    Then a new agent is created

    Examples:
      | message                              |
      | the canonical gone-agent error       |
      | a gone-agent error with no full stop |
      | a gone-agent error in capitals       |
      | a gone-agent error inside prose      |

  # BL-941 gone-agent-error-naming-no-agent-does-not-reset-02
  Scenario: a not-found error that names no agent id does not reset the session
    Given resuming the stored agent fails with a bare "Agent not found." carrying no agent id
    When the operator sends a prompt through the bridge
    Then no new agent is created
