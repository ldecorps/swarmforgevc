Feature: provider-neutral orchestration contract

# BL-142 brand-agnostic-01
Scenario: orchestration uses one interface for all providers
  Given at least two different agent providers are configured
  When Forge launches and orchestrates agents
  Then orchestration calls a single abstract contract
  And provider-specific commands are confined to adapters

# BL-142 brand-agnostic-02
Scenario: capability checks replace provider-name branching
  Given a provider lacks a capability supported by another provider
  When Forge requests that capability
  Then behavior is decided by capability flags, not hardcoded provider names

# BL-142 brand-agnostic-03
Scenario: normalized errors are actionable and consistent
  Given provider-specific failures occur during launch or interaction
  When errors surface to orchestration and operator views
  Then they are mapped to a stable Forge error taxonomy
  And include backend-specific detail as attached context

# BL-142 brand-agnostic-04
Scenario: adding a new provider requires only a new adapter
  Given a new provider integration is introduced
  When it is wired into Forge
  Then core orchestration modules do not require provider-specific edits

# Non-behavioral gates:
#  - Document the contract and adapter template.
#  - Add tests proving orchestration behavior parity across at least two providers.
#  - Include migration plan for existing provider paths.
