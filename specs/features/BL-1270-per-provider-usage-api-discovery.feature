Feature: Per-provider API plan usage discovery

  As a swarm operator,
  I want to know what each provider's usage/billing API can return,
  So that I can build a consumption-rate view from live plan data.

  Background:
    Given the swarm uses multiple provider packs
    And each provider pack is configured in swarmforge/packs/*.conf
    And a feasibility matrix document will be produced at docs/reference/per-provider-usage-api-feasibility.md

  # BL-1270 per-provider-usage-api-discovery-01
  Scenario: Feasibility matrix covers every configured provider
    Given the swarm has provider packs configured
    When the specifier produces the feasibility matrix
    Then the matrix lists every provider found in swarmforge/packs/*.conf
    And no provider is silently omitted from the matrix

  # BL-1270 per-provider-usage-api-discovery-02
  Scenario: Provider with a verified API has complete documentation
    Given a provider exposes a programmatic usage/billing API
    When the specifier researches that provider
    Then the matrix documents the endpoint URL(s)
    And the matrix documents the authentication mechanism
    And the matrix documents the response shape (JSON schema or example)
    And the matrix documents what data is returned (quota, consumed, rate, etc.)
    And the matrix documents rate limits on the usage API
    And the matrix documents any known limitations or caveats

  # BL-1270 per-provider-usage-api-discovery-03
  Scenario: Provider without an API is documented as unsupported
    Given a provider does not expose a programmatic usage API
    When the specifier researches that provider
    Then the matrix documents that no API exists
    And the matrix notes whether a manual console/dashboard exists
    And the matrix notes whether local transcript burn is the only available proxy
    And the matrix never pretends a manual or local proxy is a live plan read

  # BL-1270 per-provider-usage-api-discovery-04
  Scenario: Feasibility confidence levels are explicit
    Given the matrix lists a provider
    When a provider exposes a programmatic usage/billing API
    Then the matrix assigns a confidence level: "verified" (API tested), "documented" (API exists per docs but not tested), or "unknown" (no API found)
    And the confidence level is never inferred or assumed without evidence

  # BL-1270 per-provider-usage-api-discovery-05
  Scenario: Implementation priority is recommended
    Given the feasibility matrix is complete
    When the specifier writes the recommendation section
    Then the document recommends which providers to prioritize for implementation
    And the recommendation is based on API availability and swarm usage frequency
    And the recommendation distinguishes between "build now", "build later", and "manual fallback only"

  # BL-1270 per-provider-usage-api-discovery-06
  Scenario: Credentials remain on-host
    Given the specifier researches provider APIs
    When documenting authentication mechanisms
    Then the feasibility document describes the auth mechanism (API key, OAuth, etc.)
    And the document never includes actual credentials, tokens, or secrets
    And the document notes that credentials must remain on-host and never be committed to git
