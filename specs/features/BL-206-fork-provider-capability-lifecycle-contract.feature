Feature: Fork orchestration branches on provider capabilities, uniform lifecycle

# BL-206 capability-branching-01
Scenario: capability flags replace provider-name branching
  Given a provider lacks a capability another provider has
  When orchestration decides behavior for that provider
  Then the decision reads the provider's capability flag, not its brand name

# BL-206 new-provider-is-capabilities-02
Scenario: adding a provider is declaring its capabilities
  Given a new provider is declared with its capability flags
  When orchestration runs its lifecycle
  Then no core orchestration function is edited to accommodate it

# BL-206 lifecycle-verbs-03
Scenario Outline: every lifecycle verb is available uniformly
  Given a supported provider
  When orchestration requests the <verb> step for it
  Then a step is produced for that provider without brand-specific branching

  Examples:
    | verb    |
    | health  |
    | stop    |
    | respawn |

