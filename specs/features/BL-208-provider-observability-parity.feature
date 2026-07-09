Feature: Observability fields are comparable across providers

# BL-208 common-fields-01
Scenario: every provider emits the same core observability fields
  Given at least two different providers are active
  When their telemetry is recorded
  Then each provider's records carry the same core field keys with the same shapes

# BL-208 brand-agnostic-read-02
Scenario: a reader compares providers without brand-specific handling
  Given telemetry from multiple providers
  When a metrics/operator reader aggregates it
  Then it compares providers using the common fields, with no per-brand branch

# BL-208 empty-reads-zero-03
Scenario: a provider with no telemetry reads as empty, not an error
  Given a provider that has emitted no telemetry yet
  When the observability surface is queried
  Then its metrics read as zero/empty without error

