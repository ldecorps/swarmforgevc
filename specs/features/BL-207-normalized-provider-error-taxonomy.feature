Feature: Backend failures normalize to a stable Forge error taxonomy

# BL-207 normalize-01
Scenario: provider-specific failures map to stable categories
  Given a provider-specific failure occurs during launch or interaction
  When it surfaces to orchestration and operator views
  Then it is reported as one of the enumerated Forge error categories
  And the original backend detail is attached as context

# BL-207 cross-provider-parity-02
Scenario: the same failure class from different providers maps to one category
  Given two different providers each hit an authentication failure
  When those failures are normalized
  Then both map to the same Forge error category

# BL-207 unknown-fallback-03
Scenario: unmapped errors fall back to unknown, not a crash
  Given a backend error not covered by any mapping
  When it is normalized
  Then it is categorized as "unknown" with its raw detail attached

# Non-behavioral gates:
#  - Taxonomy is a closed, enumerable set with an explicit "unknown" fallback.
#  - Same categorization across fork orchestration and extension surfacing.
