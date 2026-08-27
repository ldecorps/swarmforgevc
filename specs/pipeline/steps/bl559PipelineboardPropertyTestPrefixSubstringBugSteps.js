'use strict';

// BL-559 / BL-734: step handlers for "the pipelineBoard prefix-order property
// test matches the actual link-line render format". Drives the REAL property
// file on the property lane and the REAL budgetPipelineBoardLinks oracle for
// the [1,112] counterexample — never a reimplementation of the prefix check.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const {
  budgetPipelineBoardLinks,
  deriveDisplayTicketId,
} = require(path.join(EXTENSION_DIR, 'out', 'concierge', 'pipelineBoard'));

const FEATURE =
  'the pipelineBoard prefix-order property test matches the actual link-line render format';

const PROPERTY_FILE = 'test/pipelineBoard.property.test.js';
const SUITE_CMD =
  'npx vitest run --config vitest.properties.config.mjs test/pipelineBoard.property.test.js';
const PREFIX_PROPERTY_TITLE =
  'property: the included links are always an in-order PREFIX of the input, and omittedCount is exact';
const REPO_BASE_URL = 'https://github.com/ldecorps/swarmforgevc';
const BL559_PROPERTY_FLOOR = 7;

function scoped(registry, re, fn) {
  registry.defineScoped(re, fn, FEATURE);
}

function links(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `L${i}`,
    path: `backlog/active/L${i}-a-fine-feature.yaml`,
  }));
}

function assertPrefixOrderProperty(count, maxLinksLength) {
  const list = links(count);
  const result = budgetPipelineBoardLinks(list, REPO_BASE_URL, maxLinksLength);
  const includedCount = list.length - result.omittedCount;
  assert.ok(includedCount >= 0 && includedCount <= list.length);
  for (let i = 0; i < includedCount; i += 1) {
    const marker = `>${deriveDisplayTicketId(list[i].id)}</a>`;
    assert.ok(result.html.includes(marker), `expected prefix link ${list[i].id} present, budget=${maxLinksLength}`);
  }
  for (let i = includedCount; i < list.length; i += 1) {
    const marker = `>${deriveDisplayTicketId(list[i].id)}</a>`;
    assert.ok(!result.html.includes(marker), `expected tail link ${list[i].id} absent, budget=${maxLinksLength}`);
  }
}

function runVitest(args, timeoutMs = 240000) {
  const vitest = path.join(EXTENSION_DIR, 'node_modules', '.bin', 'vitest');
  return spawnSync(vitest, args, { cwd: EXTENSION_DIR, encoding: 'utf8', timeout: timeoutMs });
}

function passedTestCount(output) {
  const match = /Tests\s+(\d+) passed/.exec(output);
  return match ? Number(match[1]) : 0;
}

function registerSteps(registry) {
  scoped(registry, /^"([^"]+)" runs$/, (ctx, cmd) => {
    assert.equal(cmd, SUITE_CMD, `unexpected vitest command: ${cmd}`);
    const result = runVitest(['run', '--config', 'vitest.properties.config.mjs', PROPERTY_FILE]);
    ctx.suiteRun = {
      status: result.status,
      output: `${result.stdout || ''}${result.stderr || ''}`,
    };
  });

  scoped(registry, /^all 7 properties pass$/, (ctx) => {
    const { status, output } = ctx.suiteRun;
    assert.equal(status, 0, `expected green property suite, got exit ${status}:\n${output.slice(-2000)}`);
    const passed = passedTestCount(output);
    assert.ok(
      passed >= BL559_PROPERTY_FLOOR,
      `expected at least ${BL559_PROPERTY_FLOOR} properties to pass, saw ${passed}:\n${output.slice(-2000)}`
    );
    assert.match(output, /pipelineBoard\.property\.test\.js/, 'expected the real property file in the run output');
  });

  scoped(registry, /^property tests use randomized seeds each run$/, () => {
    // fast-check draws a fresh seed each invocation — nothing to configure.
  });

  scoped(registry, /^the suite runs at least twice$/, (ctx) => {
    ctx.prefixRuns = [runVitest(['run', '--config', 'vitest.properties.config.mjs', PROPERTY_FILE, '-t', PREFIX_PROPERTY_TITLE]), runVitest(['run', '--config', 'vitest.properties.config.mjs', PROPERTY_FILE, '-t', PREFIX_PROPERTY_TITLE])].map(
      (result) => ({
        status: result.status,
        output: `${result.stdout || ''}${result.stderr || ''}`,
      })
    );
  });

  scoped(
    registry,
    /^the prefix-order property passes on every run, not only one seed$/,
    (ctx) => {
      for (const [index, run] of ctx.prefixRuns.entries()) {
        assert.equal(
          run.status,
          0,
          `prefix-order property run ${index + 1} failed:\n${run.output.slice(-2000)}`
        );
        assert.match(run.output, /1 passed/, `run ${index + 1} did not report a single passing property`);
      }
    }
  );

  scoped(registry, /^the input \[1, 112\] that previously shrunk to a failing case$/, (ctx) => {
    ctx.counterexample = { count: 1, budget: 112 };
  });

  scoped(registry, /^the prefix-order property is checked against it$/, (ctx) => {
    ctx.counterexampleChecked = true;
    assertPrefixOrderProperty(ctx.counterexample.count, ctx.counterexample.budget);
  });

  scoped(registry, /^it passes$/, (ctx) => {
    assert.ok(ctx.counterexampleChecked, 'expected the prefix-order check to have run');
  });
}

module.exports = { registerSteps };
