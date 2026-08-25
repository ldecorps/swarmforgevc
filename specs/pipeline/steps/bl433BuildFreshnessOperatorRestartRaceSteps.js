'use strict';

// BL-433: step handlers for "A build-freshness sync settles operator_runtime
// in a single pass". Drives the REAL shell test (test_build_freshness_cli.sh,
// real git commits, a real spawned operator_runtime.bb process, a real
// build_freshness_cli.bb sync/report) and greps its own PASS lines - mirrors
// mergedCodeReachesDaemonsSteps.js's own established "drive the real shell
// test, grep the PASS line" pattern for this exact sibling CLI, rather than
// re-implementing the fixture here a second time.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const FRESHNESS_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_build_freshness_cli.sh');

function runFreshnessTest(ctx) {
  if (ctx.bl433FreshnessOutput) {
    return ctx.bl433FreshnessOutput;
  }
  const result = spawnSync('bash', [FRESHNESS_TEST], { encoding: 'utf8', timeout: 120000 });
  ctx.bl433FreshnessOutput = (result.stdout || '') + (result.stderr || '');
  return ctx.bl433FreshnessOutput;
}

function expectLine(output, fragment, label) {
  if (!output.includes(fragment)) {
    throw new Error(`expected "${fragment}" (${label}) in the real build_freshness_cli test output, got:\n${output}`);
  }
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^operator_runtime is running on a stale build and main has advanced$/, () => {
    // Purely contextual - the real fixture (a real spawned operator_runtime,
    // then a real advancing commit) lives inside the shell test itself;
    // nothing to arrange here.
  });

  // ── build-freshness-operator-restart-race-01/02/03 ───────────────────
  registry.define(/^a build-freshness sync runs once$/, (ctx) => {
    ctx.output = runFreshnessTest(ctx);
  });

  registry.define(/^the sync restarts operator_runtime$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(
      output,
      'build-freshness-operator-restart-race-01/02/03: a single sync settles operator_runtime',
      '01'
    );
  });

  registry.define(/^the returned report shows operator_runtime is not stale$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(
      output,
      'build-freshness-operator-restart-race-01/02/03: a single sync settles operator_runtime',
      '01'
    );
  });

  registry.define(/^the returned report reflects operator_runtime's state after the restart settled$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(
      output,
      'its own report already reflects the post-restart state',
      '02'
    );
  });

  registry.define(/^not the state captured before the restart$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(
      output,
      'its own report already reflects the post-restart state',
      '02'
    );
  });

  registry.define(/^a build-freshness sync has run once and restarted operator_runtime$/, (ctx) => {
    ctx.output = runFreshnessTest(ctx);
  });

  registry.define(/^a build-freshness report runs immediately afterwards$/, (ctx) => {
    ctx.output = ctx.output || runFreshnessTest(ctx);
  });

  registry.define(/^that separate report also finds operator_runtime fresh$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(
      output,
      'a separate report immediately after needs no second sync pass',
      '03'
    );
  });

  // ── build-freshness-operator-restart-race-04 ─────────────────────────
  registry.define(/^the restarted operator_runtime never publishes a fresh status$/, () => {
    // Purely contextual - the shell test's own 1ms settle-timeout fixture is
    // what forces this condition deterministically without faking any part
    // of the real restart mechanism.
  });

  registry.define(/^the sync exits non-zero within a bounded timeout$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(
      output,
      'build-freshness-operator-restart-race-04: a restarted process that never settles within the bound fails the sync loudly (non-zero exit)',
      '04'
    );
  });

  registry.define(/^it does not report operator_runtime as fresh$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(output, 'never hangs, never falsely reports fresh', '04');
  });

  // ── build-freshness-operator-restart-race-05 ─────────────────────────
  registry.define(/^the front-desk group and the handoffd group are running on a stale build$/, () => {
    // Purely contextual - the shell test's own pre-existing sections
    // (merged-code-reaches-daemons-02/03(compiled), -03(interpreted)) are
    // the real fixture for this; nothing new to arrange here.
  });

  registry.define(/^each of those groups is restarted as it was before$/, (ctx) => {
    const output = ctx.output || runFreshnessTest(ctx);
    expectLine(
      output,
      "merged-code-reaches-daemons-02/03(compiled): a real merge to a real running process's source reaches it via one coordinator-invoked sync call, no other human action",
      '05 front-desk'
    );
    expectLine(
      output,
      'merged-code-reaches-daemons-03(interpreted): a long-lived Babashka daemon is covered too, not just compiled processes',
      '05 handoffd'
    );
  });
}

module.exports = { registerSteps };
