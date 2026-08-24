'use strict';

// BL-752: prove the non-stage backlog basename collision, and that every
// bl694ResidualAllowlistSteps.js handler matches at least one rendered step.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ALLOWED_EXACT_PATHS,
  ALLOWED_BACKLOG_TICKET_BASENAMES,
  backlogStagePath,
  isAllowlisted,
  scanUnexpected,
} = require('../../../extension/test/onboarderResidualAllowlist');

const FEATURE =
  'a basename match at a non-stage backlog path is proven, not asserted';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BL694_FEATURE = path.join(
  REPO_ROOT,
  'specs',
  'features',
  'BL-694-residual-word-allowlist-survives-stage-moves.feature'
);
const BL694_STEPS = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'bl694ResidualAllowlistSteps.js');

const GRANDFATHERED_BASENAME = 'BL-624-onboarding-facilitator-survey-to-gate.yaml';

function extractDefinePatterns(source) {
  const patterns = [];
  // Local `scoped(/^...$/` helper (and any define/defineScoped forms).
  const re = /(?:\.define(?:Scoped)?|scoped)\(\s*\/\^([\s\S]+?)\$\//g;
  let m;
  while ((m = re.exec(source))) {
    patterns.push(m[1]);
  }
  return patterns;
}

function renderFeatureSteps(featureText) {
  // Expand Scenario Outline Examples into concrete step lines (naive but
  // sufficient for BL-694's single-placeholder outlines).
  const steps = [];
  const blocks = featureText.split(/\n(?=  (?:Scenario(?: Outline)?:|#))/);
  for (const block of blocks) {
    if (!/Scenario Outline:/.test(block)) {
      for (const line of block.split('\n')) {
        const m = line.match(/^\s+(?:Given|When|Then|And) (.+)$/);
        if (m) steps.push(m[1].trim());
      }
      continue;
    }
    const exampleMatch = block.match(/Examples:\s*\n((?:\s*\|[^\n]+\n)+)/);
    if (!exampleMatch) continue;
    const rows = exampleMatch[1]
      .trim()
      .split('\n')
      .map((r) =>
        r
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim())
      );
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const outlineSteps = [];
    for (const line of block.split('\n')) {
      const m = line.match(/^\s+(?:Given|When|Then|And) (.+)$/);
      if (m && !m[1].includes('Examples')) outlineSteps.push(m[1].trim());
    }
    for (const row of dataRows) {
      const vars = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
      for (const tpl of outlineSteps) {
        let s = tpl;
        for (const [k, v] of Object.entries(vars)) {
          s = s.replace(new RegExp(`<${k}>`, 'g'), v);
        }
        if (!s.includes('<')) steps.push(s);
      }
    }
  }
  return steps;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a grandfathered ticket file on the residual-word allowlist$/, (ctx) => {
    ctx.allowlistOpts = {
      exactPaths: new Set(ALLOWED_EXACT_PATHS),
      backlogBasenames: new Set(ALLOWED_BACKLOG_TICKET_BASENAMES),
    };
    ctx.grandfatheredBasename = GRANDFATHERED_BASENAME;
    ctx.grandfatheredPath = backlogStagePath('paused', GRANDFATHERED_BASENAME);
    assert.ok(isAllowlisted(ctx.grandfatheredPath, ctx.allowlistOpts));
  });

  scoped(/^a different file with the same basename under backlog\/topics$/, (ctx) => {
    ctx.conflictPath = `backlog/topics/${ctx.grandfatheredBasename}`;
    ctx.extraMatches = [ctx.grandfatheredPath, ctx.conflictPath];
  });

  scoped(/^the grandfathered file sits at a stage path under the backlog$/, (ctx) => {
    ctx.extraMatches = [ctx.grandfatheredPath];
  });

  scoped(/^the residual-word scan runs$/, (ctx) => {
    ctx.unexpected = scanUnexpected(ctx.extraMatches ?? [], ctx.allowlistOpts);
  });

  scoped(/^the scan reports the different file as an unexpected match$/, (ctx) => {
    assert.ok(
      ctx.unexpected.includes(ctx.conflictPath),
      `expected ${ctx.conflictPath} unexpected, got ${JSON.stringify(ctx.unexpected)}`
    );
    assert.ok(
      !ctx.unexpected.includes(ctx.grandfatheredPath),
      `grandfathered ${ctx.grandfatheredPath} must stay excused`
    );
  });

  scoped(/^the scan reports no unexpected match$/, (ctx) => {
    assert.deepEqual(ctx.unexpected, []);
  });

  scoped(/^the residual-allowlist step handlers as registered$/, (ctx) => {
    ctx.bl694Source = fs.readFileSync(BL694_STEPS, 'utf8');
    ctx.handlerPatterns = extractDefinePatterns(ctx.bl694Source);
    assert.ok(ctx.handlerPatterns.length > 0, 'expected handlers in bl694ResidualAllowlistSteps.js');
  });

  scoped(/^each registered handler is matched against every step the feature renders$/, (ctx) => {
    const featureText = fs.readFileSync(BL694_FEATURE, 'utf8');
    ctx.renderedSteps = renderFeatureSteps(featureText);
    assert.ok(ctx.renderedSteps.length > 0, 'expected rendered steps from BL-694 feature');
    // Pin that the previously-dead non-stage wording is among them.
    assert.ok(
      ctx.renderedSteps.some((s) => /non-stage path under the backlog/.test(s)),
      `BL-694 must render a non-stage backlog step; got: ${JSON.stringify(ctx.renderedSteps)}`
    );
  });

  scoped(/^every registered handler matches at least one rendered step$/, (ctx) => {
    const unmatched = [];
    for (const raw of ctx.handlerPatterns) {
      let re;
      try {
        re = new RegExp(`^${raw}$`);
      } catch {
        unmatched.push(`invalid pattern: ${raw}`);
        continue;
      }
      if (!ctx.renderedSteps.some((step) => re.test(step))) {
        unmatched.push(raw);
      }
    }
    assert.deepEqual(unmatched, [], `unreachable handlers:\n${unmatched.join('\n')}`);
  });
}

module.exports = { registerSteps };
