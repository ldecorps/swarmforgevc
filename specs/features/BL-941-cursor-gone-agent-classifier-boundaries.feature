# mutation-stamp: sha256=df1a873ccee4a5da1c56597d178190b72ba4d11a4ede74576952e5d7370038a0
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T12:21:56.260649914Z","feature_name":"the Cursor gone-agent classifier holds its boundaries","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-941-cursor-gone-agent-classifier-boundaries.feature","background_hash":"8fb938996674e40718be7a74fe55d624cb0efe74f6dc35239589407b51f38a43","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the stored agent is gone whatever the surface formatting","scenario_hash":"699b9cb5a79b5f44797e86a6d95ddf7cec18743d57033474b48126ef834c716c","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-27T12:21:56.260649914Z"}]}
# acceptance-mutation-manifest-end

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
