Feature: Extension pane-state detection is driven by provider descriptors

# BL-142 descriptor-parity-01
Scenario: detection reads a provider registry, not inline brand names
  Given the supported providers are expressed as descriptors in a registry
  When pane state is computed for a pane running any supported provider CLI
  Then the result matches the pre-refactor behavior for that provider
  And no provider brand name is hardcoded in the detection functions

# BL-142 new-provider-is-data-02
Scenario: adding a provider requires only a new descriptor
  Given a new provider descriptor (name, cli pattern, busy pattern, banner,
    startup copy) is added to the registry
  When a pane runs that provider's CLI
  Then the provider is recognized and its busy, running, and startup states
    are detected from the descriptor
  And no detection function is edited to add it

# BL-142 startup-copy-03
Scenario: startup guidance comes from the descriptor, not a hardcoded brand
  Given a pane whose provider has not started yet
  When the startup guidance message is produced
  Then it names the provider from its descriptor (e.g. "Waiting for <provider>
    to start…")
  And it is not a hardcoded "Claude" literal

