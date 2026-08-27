'use strict';

// BL-999: step handlers for "A test budget is justified, not merely present".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTestTimeouts } = require('./lib/testTimeoutParser');

const FEATURE = 'A test budget is justified, not merely present';
const REPO = path.join(__dirname, '..', '..', '..');
const TEST_FILE = path.join(REPO, 'extension', 'test', 'renderBriefingBurndownCli.test.js');
const BUDGETS = path.join(REPO, 'extension', 'test', 'renderBriefingBurndownCli.budgets.js');

function ensure(ctx) {
  if (!ctx.bl999) ctx.bl999 = {};
  return ctx.bl999;
}

function classifyFromSource(source) {
  const {
    evaluateRealRepoBudgets,
    evaluateFixtureDecisions,
    classifyBurndownCliTests,
  } = require(BUDGETS);
  const classified = classifyBurndownCliTests(source, parseTestTimeouts);
  return {
    classified,
    realFailures: evaluateRealRepoBudgets(classified),
    fixtureFailures: evaluateFixtureDecisions(classified),
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the burndown CLI test file and its recorded load measurements$/, (ctx) => {
    assert.ok(fs.existsSync(TEST_FILE));
    assert.ok(fs.existsSync(BUDGETS));
    ensure(ctx).source = fs.readFileSync(TEST_FILE, 'utf8');
  });

  scoped(/^the budget guard runs$/, (ctx) => {
    const st = ensure(ctx);
    const source = st.overrideSource || st.source;
    st.result = classifyFromSource(source);
  });

  scoped(/^each real-repo test's budget is at least its worst recorded run times the standard margin$/, (ctx) => {
    assert.deepEqual(ensure(ctx).result.realFailures, []);
  });

  scoped(/^three tests that all derive from the real repo and render$/, (ctx) => {
    const st = ensure(ctx);
    st.source = fs.readFileSync(TEST_FILE, 'utf8');
    const { classified } = classifyFromSource(st.source);
    assert.equal(classified.filter((c) => !c.fixture).length, 3);
  });

  scoped(/^their budgets are equal$/, (ctx) => {
    const real = ensure(ctx).result.classified.filter((c) => !c.fixture);
    assert.ok(real.length >= 2);
    assert.ok(real.every((c) => c.timeoutMs === real[0].timeoutMs));
  });

  scoped(/^a test that carries no explicit budget$/, (ctx) => {
    const st = ensure(ctx);
    st.source = fs.readFileSync(TEST_FILE, 'utf8');
    const { classified } = classifyFromSource(st.source);
    assert.ok(classified.some((c) => c.fixture && c.timeoutMs == null));
  });

  scoped(/^that test's recorded margin against the suite default is present$/, (ctx) => {
    assert.deepEqual(ensure(ctx).result.fixtureFailures, []);
  });

  scoped(/^a heavy test whose budget is below its worst recorded run$/, (ctx) => {
    const st = ensure(ctx);
    // Inject a too-small explicit timeout on the first real-repo test site.
    let source = fs.readFileSync(TEST_FILE, 'utf8');
    source = source.replace(
      /90000\n\);\n\ntest\(\n  'renderBriefingBurndown falls back to deriving its own history when the given snapshot path does not exist'/,
      `1\n);\n\ntest(\n  'renderBriefingBurndown falls back to deriving its own history when the given snapshot path does not exist'`
    );
    st.overrideSource = source;
  });

  scoped(/^the guard fails$/, (ctx) => {
    assert.ok(ensure(ctx).result.realFailures.length >= 1);
  });

  scoped(/^the failure names that test, its budget and the measurement it fails to cover$/, (ctx) => {
    const msg = ensure(ctx).result.realFailures.join('\n');
    assert.match(msg, /budget 1ms/);
    assert.match(msg, /worst recorded/);
    assert.match(msg, /required/);
  });
}

module.exports = { registerSteps };
