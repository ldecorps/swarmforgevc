Feature: QuotaManager answers whether a role/provider is available right now

  # Backlog root intake 003-adaptive-quota-budget-manager.md, drained by
  # specifier 2026-07-22. Slice 1 only: a read-only availability check that
  # REUSES existing state rather than inventing new quota storage —
  # extension/src/swarm/cooldownScheduler.ts's rate-limit cooldown file
  # (BL-082/BL-209) and BL-551's llm-cost ledger for a configured daily
  # dollar budget ceiling. No new persisted quota state in this slice.
  #
  # Out of scope for Slice 1: RPM/TPM tracking, monthly-subscription quotas,
  # telemetry-learned quota discovery, forecasting, auto-failover. Those are
  # future slices per BL-552's epic notes, added only once a real caller
  # (ModelFactory, BL-525) exists to consume this check.

  Background:
    Given a role/provider pair with no recorded state is available by default
    And availability is evaluated at a fixed injected instant

  # BL-553 cooldown-blocks-01
  Scenario: a role/provider under an active rate-limit cooldown is unavailable
    Given the rate-limit cooldown file records an untilMs in the future for the role/provider
    When QuotaManager is asked whether the role/provider is available
    Then it reports unavailable with reason rate_limit_cooldown and the cooldown untilMs

  # BL-553 cooldown-expires-02
  Scenario: a role/provider becomes available again once its cooldown untilMs has passed
    Given the rate-limit cooldown file records an untilMs in the past for the role/provider
    When QuotaManager is asked whether the role/provider is available
    Then it reports available

  # BL-553 budget-ceiling-03
  Scenario: a provider over its configured daily dollar budget ceiling is unavailable
    Given a daily dollar budget ceiling is configured for the provider
    And the cost ledger's summed spend for the provider today meets or exceeds that ceiling
    When QuotaManager is asked whether the provider is available
    Then it reports unavailable with reason budget_ceiling_reached

  # BL-553 budget-under-04
  Scenario: a provider under its configured daily dollar budget ceiling is available
    Given a daily dollar budget ceiling is configured for the provider
    And the cost ledger's summed spend for the provider today is below that ceiling
    When QuotaManager is asked whether the provider is available
    Then it reports available

  # BL-553 unknown-cost-excluded-05
  Scenario: unknown-cost ledger rows never count toward the budget ceiling
    Given the cost ledger has a priced row and an unknown-cost row for the provider today
    And the priced row alone is below the configured daily dollar budget ceiling
    When QuotaManager is asked whether the provider is available
    Then it reports available
    And the unknown-cost row is not counted toward the spend total

  # BL-553 no-ceiling-configured-06
  Scenario: a provider with no configured budget ceiling is never blocked on budget
    Given no daily dollar budget ceiling is configured for the provider
    And the cost ledger's summed spend for the provider today is nonzero
    When QuotaManager is asked whether the provider is available
    Then it reports available

  # BL-553 both-signals-priority-07
  Scenario: an active cooldown takes priority over a passing budget check
    Given the rate-limit cooldown file records an untilMs in the future for the role/provider
    And the cost ledger's summed spend for the provider today is below its configured daily dollar budget ceiling
    When QuotaManager is asked whether the role/provider is available
    Then it reports unavailable with reason rate_limit_cooldown
