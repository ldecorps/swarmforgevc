'use strict';

// BL-1247: the BL-593 telemetry property test's scope generator must never
// draw a value the production guard (requireLoadBearingMeta) refuses as
// not load-bearing. Drives the REAL compiled buildMutationRunRecord and the
// REAL shared generator (test/support/bl593ScopeArb.js - the same module
// bl593MutationRunTelemetry.property.test.js itself uses) rather than a
// reimplementation of either.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1247 the BL-593 telemetry property test agrees with the contract it exercises, so the property lane stops flaking';

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const fc = require(path.join(EXTENSION_DIR, 'node_modules', 'fast-check'));

const BLANK_SCOPES = {
  'a single space': ' ',
  'a single tab': '\t',
  'spaces and a newline': ' \n ',
  'the empty string': '',
};

function registerBl1247PropertyGeneratorDomainAgreementSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the extension is compiled$/, () => {
    execFileSync('npm', ['run', 'compile'], { cwd: EXTENSION_DIR, encoding: 'utf8' });
  });

  scoped(/^"([^"]+)" runs (\d+) consecutive times in isolation$/, (ctx, testFile, count) => {
    const runs = [];
    for (let i = 0; i < Number(count); i += 1) {
      const result = spawnSync(
        'npx',
        ['vitest', 'run', testFile, '--config', 'vitest.properties.config.mjs'],
        { cwd: EXTENSION_DIR, encoding: 'utf8' }
      );
      runs.push({ status: result.status, stdout: result.stdout, stderr: result.stderr });
    }
    ctx.bl1247isolationRuns = runs;
  });

  scoped(/^every one of those runs passes$/, (ctx) => {
    const runs = ctx.bl1247isolationRuns;
    const failed = runs.filter((r) => r.status !== 0);
    assert.equal(
      failed.length,
      0,
      `${failed.length} of ${runs.length} isolated runs failed:\n${failed.map((r) => r.stdout + r.stderr).join('\n---\n')}`
    );
  });

  scoped(/^(\d+) values are drawn from the scope generator the property uses$/, (ctx, count) => {
    const { nonBlankScope } = require(path.join(EXTENSION_DIR, 'test', 'support', 'bl593ScopeArb.js'));
    const { buildMutationRunRecord } = require(path.join(EXTENSION_DIR, 'out', 'mutation', 'mutationRunTelemetry.js'));
    const { initMutationProgressState } = require(path.join(EXTENSION_DIR, 'out', 'mutation', 'mutationProgress.js'));
    const START = Date.parse('2026-01-01T00:00:00Z');
    const state = initMutationProgressState(10, START);
    const drawn = fc.sample(nonBlankScope, Number(count));
    const rejected = [];
    for (const scope of drawn) {
      try {
        buildMutationRunRecord(state, START + 1000, {
          role: 'coder',
          scope,
          incremental: false,
          concurrency: 1,
          buildSha: 'x',
        });
      } catch (e) {
        rejected.push({ scope, message: e.message });
      }
    }
    ctx.bl1247drawn = drawn;
    ctx.bl1247rejected = rejected;
  });

  scoped(/^every drawn value is accepted by buildMutationRunRecord as a load-bearing scope$/, (ctx) => {
    assert.equal(
      ctx.bl1247rejected.length,
      0,
      `${ctx.bl1247rejected.length} of ${ctx.bl1247drawn.length} drawn values were rejected: ${JSON.stringify(ctx.bl1247rejected.slice(0, 10))}`
    );
  });

  scoped(/^a mutation run record is built with a scope that is (.+)$/, (ctx, scopeLabel) => {
    assert.ok(scopeLabel in BLANK_SCOPES, `unknown scope label: ${scopeLabel}`);
    const scope = BLANK_SCOPES[scopeLabel];
    const { buildMutationRunRecord } = require(path.join(EXTENSION_DIR, 'out', 'mutation', 'mutationRunTelemetry.js'));
    const { initMutationProgressState } = require(path.join(EXTENSION_DIR, 'out', 'mutation', 'mutationProgress.js'));
    const START = Date.parse('2026-01-01T00:00:00Z');
    const state = initMutationProgressState(10, START);
    ctx.bl1247error = null;
    try {
      buildMutationRunRecord(state, START + 1000, {
        role: 'coder',
        scope,
        incremental: false,
        concurrency: 1,
        buildSha: 'x',
      });
    } catch (e) {
      ctx.bl1247error = e;
    }
  });

  scoped(/^building it throws "([^"]+)"$/, (ctx, expectedMessage) => {
    assert.ok(ctx.bl1247error, 'expected buildMutationRunRecord to throw, it did not');
    assert.equal(ctx.bl1247error.message, expectedMessage);
  });
}

module.exports = { registerSteps: registerBl1247PropertyGeneratorDomainAgreementSteps };
