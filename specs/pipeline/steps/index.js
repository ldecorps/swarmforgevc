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
  require('./providerObservabilityParitySteps'),
  require('./pwaLabelCatalogSteps'),
  require('./readyForNextPromotionSteps'),
  require('./swarmIntakeEnvRouteSteps'),
  require('./pwaFontSizeSteps'),
  require('./complianceBatterySteps'),
  require('./burndownEtaSteps'),
  require('./pwaTranslatedContentSteps'),
  require('./sidecarNoOrphanSteps'),
  require('./recruiterDiscoverSteps'),
  require('./backlogFoldersStatusSteps'),
  require('./backendSwitchSteps'),
  require('./docsWindowsClaimSteps'),
  require('./effortDialSteps'),
  require('./accessibilitySteps'),
  require('./gateAnswerSteps'),
  require('./deviceRegistrySteps'),
  require('./coordinatorProvisioningSteps'),
  require('./telegramAdapterSteps'),
  require('./recertSenderAllowlistSteps'),
  require('./pwaCacheStampSteps'),
  require('./qaIntegratesCoordinatorBookkeepsSteps'),
  require('./recruiterAcquireSteps'),
  require('./recruiterQualifySteps'),
  require('./recruiterRankRecommendSteps'),
  require('./compositeNodeSteps'),
  require('./bakeoffRosterSteps'),
  require('./bakeoffPipelineSteps'),
  require('./coordinatorLossSteps'),
  require('./fleetConsoleSteps'),
  require('./docsSearchFilterSteps'),
  require('./docsImplementedStatusSteps'),
  require('./suiteDurationReadoutSteps'),
];

function registerSteps(registry) {
  for (const domain of DOMAINS) {
    domain.registerSteps(registry);
  }
}

module.exports = { registerSteps };
