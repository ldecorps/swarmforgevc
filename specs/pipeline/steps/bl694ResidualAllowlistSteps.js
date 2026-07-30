'use strict';

const path = require('node:path');

const {
  ALLOWED_EXACT_PATHS,
  ALLOWED_BACKLOG_TICKET_BASENAMES,
  backlogStagePath,
  isAllowlisted,
  scanUnexpected,
} = require('../../../extension/test/onboarderResidualAllowlist');

const FEATURE_NAME = 'a grandfathered ticket keeps its allowlist entry when it changes backlog stage';

const GRANDFATHERED_BASENAME = 'BL-624-onboarding-facilitator-survey-to-gate.yaml';
const UNGRANDFATHERED_PATH = 'backlog/paused/BL-999-not-on-allowlist-facilitator.yaml';

function conflictBasename(ctx) {
  return ctx.grandfatheredBasename ?? path.basename(ctx.grandfatheredPath);
}

function registerSteps(registry) {
  registry.define(/^a residual-word scan with an allowlist of grandfathered files$/, (ctx) => {
    ctx.allowlistOpts = {
      exactPaths: new Set(ALLOWED_EXACT_PATHS),
      backlogBasenames: new Set(ALLOWED_BACKLOG_TICKET_BASENAMES),
    };
    ctx.extraMatches = [];
  });

  registry.define(/^a grandfathered ticket file allowlisted by its filename$/, (ctx) => {
    ctx.grandfatheredBasename = GRANDFATHERED_BASENAME;
  });

  registry.define(/^the ticket sits in (active|paused|hold)$/, (ctx, stage) => {
    const file = backlogStagePath(stage, ctx.grandfatheredBasename);
    if (!isAllowlisted(file, ctx.allowlistOpts)) {
      throw new Error(`expected ${file} to be allowlisted by basename`);
    }
    ctx.extraMatches = [...(ctx.extraMatches ?? []), file];
  });

  registry.define(/^the ticket moves to another stage directory$/, (ctx) => {
    for (const stage of ['active', 'paused', 'hold']) {
      const file = backlogStagePath(stage, ctx.grandfatheredBasename);
      if (!isAllowlisted(file, ctx.allowlistOpts)) {
        throw new Error(`expected ${file} to stay allowlisted after a stage move`);
      }
      ctx.extraMatches.push(file);
    }
  });

  registry.define(/^a ticket file carrying the retired word that is not on the allowlist$/, (ctx) => {
    ctx.extraMatches = [...(ctx.extraMatches ?? []), UNGRANDFATHERED_PATH];
  });

  registry.define(/^a grandfathered file allowlisted by its filename$/, (ctx) => {
    ctx.grandfatheredBasename = GRANDFATHERED_BASENAME;
    ctx.grandfatheredPath = backlogStagePath('paused', ctx.grandfatheredBasename);
  });

  registry.define(/^a grandfathered file allowlisted by exact path$/, (ctx) => {
    ctx.grandfatheredPath = 'specs/features/BL-590-onboarding-facilitator-slice1-topic-prereqs.feature';
    if (!ALLOWED_EXACT_PATHS.has(ctx.grandfatheredPath)) {
      throw new Error(`fixture: ${ctx.grandfatheredPath} must be an exact-path allowlist entry`);
    }
  });

  registry.define(/^a different file with the same basename at outside the backlog$/, (ctx) => {
    ctx.conflictPath = `docs/tmp/${conflictBasename(ctx)}`;
    ctx.extraMatches = [...(ctx.extraMatches ?? []), ctx.grandfatheredPath, ctx.conflictPath];
  });

  registry.define(
    /^a different file with the same basename at (?:at )?a non-stage path under the backlog$/,
    (ctx) => {
      ctx.conflictPath = `backlog/topics/${conflictBasename(ctx)}`;
      ctx.extraMatches = [...(ctx.extraMatches ?? []), ctx.grandfatheredPath, ctx.conflictPath];
    }
  );

  registry.define(/^a different file with the same basename at elsewhere in the tree$/, (ctx) => {
    ctx.conflictPath = `specs/tmp/${conflictBasename(ctx)}`;
    ctx.extraMatches = [...(ctx.extraMatches ?? []), ctx.grandfatheredPath, ctx.conflictPath];
  });

  registry.define(/^an allowlist entry naming a file that no longer exists$/, (ctx) => {
    const stale = 'backlog/active/BL-684-rename-onboarding-facilitator-to-onboarder.yaml';
    ctx.allowlistOpts.exactPaths.add(stale);
    // Stale entry is inert — scan must not fail merely because it matches nothing.
  });

  registry.define(/^the scan runs$/, (ctx) => {
    ctx.unexpected = scanUnexpected(ctx.extraMatches ?? [], ctx.allowlistOpts);
  });

  registry.define(/^the scan reports no unexpected match$/, (ctx) => {
    if (ctx.unexpected === undefined) {
      ctx.unexpected = scanUnexpected(ctx.extraMatches ?? [], ctx.allowlistOpts);
    }
    if (ctx.unexpected.length > 0) {
      throw new Error(`expected no unexpected matches, got: ${JSON.stringify(ctx.unexpected)}`);
    }
  });

  registry.define(/^the scan reports it as an unexpected match$/, (ctx) => {
    if (ctx.unexpected === undefined) {
      ctx.unexpected = scanUnexpected(ctx.extraMatches ?? [], ctx.allowlistOpts);
    }
    const target = ctx.conflictPath ?? UNGRANDFATHERED_PATH;
    if (!ctx.unexpected.includes(target)) {
      throw new Error(`expected ${target} in unexpected matches, got: ${JSON.stringify(ctx.unexpected)}`);
    }
  });

  registry.define(/^the scan reports the different file as an unexpected match$/, (ctx) => {
    if (ctx.unexpected === undefined) {
      ctx.unexpected = scanUnexpected(ctx.extraMatches ?? [], ctx.allowlistOpts);
    }
    if (!ctx.unexpected.includes(ctx.conflictPath)) {
      throw new Error(
        `expected basename collision ${ctx.conflictPath} to be unexpected, got: ${JSON.stringify(ctx.unexpected)}`
      );
    }
    if (ctx.unexpected.includes(ctx.grandfatheredPath)) {
      throw new Error(`grandfathered path ${ctx.grandfatheredPath} must not be reported unexpected`);
    }
  });
}

module.exports = { registerSteps, FEATURE_NAME };
