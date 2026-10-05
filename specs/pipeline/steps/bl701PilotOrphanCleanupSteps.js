'use strict';

const pilot = require('../../../extension/out/tools/telegramCursorBridgePilot');

const FEATURE = 'Cursor /pilot cleans orphan acceptance and Stryker at stage boundaries';

function registerSteps(registry) {
  registry.defineScoped(/^the pilot expeditor prompt composer is available$/, (ctx) => {
    if (typeof pilot.composePilotExpeditorPrompt !== 'function') {
      throw new Error('expected composePilotExpeditorPrompt to be available');
    }
  }, FEATURE);

  registry.defineScoped(/^the offline expeditor prompt is composed for ticket "([^"]+)"$/, (ctx, ticket) => {
    ctx.prompt = pilot.composePilotExpeditorPrompt(ticket);
  }, FEATURE);

  registry.defineScoped(/^the prompt requires checking and killing leftover acceptance runners from this expedition$/, (ctx) => {
    if (!ctx.prompt.includes('check and kill') || !ctx.prompt.includes('hung acceptance runners')) {
      throw new Error('expected prompt to require checking and killing leftover acceptance runners');
    }
  }, FEATURE);

  registry.defineScoped(/^the prompt requires checking leftover Stryker or mutation jobs$/, (ctx) => {
    if (!ctx.prompt.includes('leftover Stryker / mutation jobs')) {
      throw new Error('expected prompt to require checking leftover Stryker / mutation jobs');
    }
  }, FEATURE);

  registry.defineScoped(/^the prompt requires checking related disposable \/tmp\/tmp\.\* ancillaries from the run$/, (ctx) => {
    if (!ctx.prompt.includes('/tmp/tmp.*') || !ctx.prompt.includes('babysitter / bridge processes')) {
      throw new Error('expected prompt to require checking disposable /tmp/tmp.* ancillaries');
    }
  }, FEATURE);
}

module.exports = { registerSteps };
