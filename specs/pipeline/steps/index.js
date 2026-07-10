'use strict';

// Combines every domain's step handlers into the project step registry.
// The ticket's step-handler surface allowlist is tmux socket discovery,
// .swarmforge state parsing, handoff protocol, backlog parsing, and grid
// layout logic (local-engineering.prompt); domains are added here
// incrementally as tickets need their vocabulary, same as backlogSteps.
const DOMAINS = [
  require('./backlogSteps'),
  require('./daemonWorkflowSteps'),
  require('./launchSpawnFailureSteps'),
  require('./mailboxIntakeSteps'),
  require('./strykerPwaSandboxSteps'),
  require('./dispatchGapSteps'),
  require('./backlogDepthSteps'),
  require('./remoteWakeupSteps'),
  require('./rateLimitCooldownSteps'),
  require('./emailMissingKeySteps'),
  require('./briefingEmailSteps'),
  require('./recertAddressSteps'),
  require('./webhookSecretFixtureSteps'),
  require('./providerErrorTaxonomySteps'),
  require('./gherkinMutationSteps'),
  require('./swarmMutationCostPrepassSteps'),
];

function registerSteps(registry) {
  for (const domain of DOMAINS) {
    domain.registerSteps(registry);
  }
}

module.exports = { registerSteps };
