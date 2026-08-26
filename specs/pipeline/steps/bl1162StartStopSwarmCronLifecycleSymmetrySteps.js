'use strict';

// BL-1162: start-swarm installs every swarmforge cron; stop-swarm removes all.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE_NAME =
  'start-swarm installs every swarmforge cron for a root and stop-swarm removes them all';

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const MAIN_TEST = path.join(
  SWARMFORGE_SCRIPTS,
  'test',
  'test_bl1162_start_stop_swarm_cron_lifecycle.sh',
);
const PROPERTY_TEST = path.join(
  SWARMFORGE_SCRIPTS,
  'test',
  'bl1162_swarmforge_cron_property_runner.sh',
);

function runSuite(ctx, outputKey, exitKey, file) {
  if (ctx[outputKey] !== undefined) {
    return ctx[outputKey];
  }
  const result = spawnSync('bash', [file], {
    encoding: 'utf8',
    timeout: 180000,
    env: process.env,
  });
  ctx[outputKey] = `${result.stdout || ''}${result.stderr || ''}`;
  ctx[exitKey] = result.status;
  return ctx[outputKey];
}

function runMainSuite(ctx) {
  return runSuite(ctx, 'bl1162Output', 'bl1162Exit', MAIN_TEST);
}

function runPropertySuite(ctx) {
  return runSuite(ctx, 'bl1162PropertyOutput', 'bl1162PropertyExit', PROPERTY_TEST);
}

function expectLine(output, fragment, label) {
  if (!output.includes(fragment)) {
    throw new Error(`expected "${fragment}" (${label}) in BL-1162 suite output, got:\n${output}`);
  }
}

function registerSteps(registry) {
  const scoped = (pattern, fn) => registry.defineScoped(pattern, fn, FEATURE_NAME);

  scoped(/^a fixture host user crontab seam$/, (ctx) => {
    runMainSuite(ctx);
    if (ctx.bl1162Exit !== 0) {
      throw new Error(`BL-1162 lifecycle suite exited ${ctx.bl1162Exit}:\n${ctx.bl1162Output}`);
    }
  });

  scoped(/^a fixture swarm root R with operator schedule scripts present$/, (ctx) => {
    ctx.bl1162Root = 'R';
    runMainSuite(ctx);
  });

  scoped(/^the user crontab has freshness and schedule start stop lines for root R$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^the swarm for root R is up$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^the operator runs stop-swarm\.sh for root R$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^crontab -l contains no line with a swarmforge marker or path scoped to root R$/, (ctx) => {
    const output = runMainSuite(ctx);
    expectLine(output, 'PASS: 01: stop-swarm leaves no swarmforge cron lines scoped to root R', '01');
    runPropertySuite(ctx);
    expectLine(
      ctx.bl1162PropertyOutput,
      'BL-1162 swarmforge-cron property: ALL CHECKS PASSED',
      'prop-stop',
    );
  });

  scoped(
    /^no scheduled script under root R \.swarmforge operator can fire for root R$/,
    (ctx) => {
      const output = runMainSuite(ctx);
      expectLine(output, 'ok   - 01: stop removed root paths', '01-paths');
    },
    FEATURE_NAME,
  );

  scoped(/^the user crontab has no swarmforge lines for root R$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^operator conf selects a shift schedule for root R$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^the operator runs start-swarm\.sh for root R$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^crontab -l contains the freshness line for root R$/, (ctx) => {
    const output = runMainSuite(ctx);
    expectLine(output, 'ok   - 02: start installed freshness', '02-fresh');
  });

  scoped(/^crontab -l contains the rendered start and stop schedule lines for root R$/, (ctx) => {
    const output = runMainSuite(ctx);
    expectLine(output, 'ok   - 02: start installed schedule start', '02-start');
    expectLine(output, 'ok   - 02: start installed schedule stop', '02-stop');
    expectLine(output, 'PASS: 02: start-swarm ensures required swarmforge cron lines for root R', '02');
  });

  scoped(/^stop-swarm\.sh for root R completed successfully$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^two minutes elapse$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^the next schedule boundary passes if any schedule line had remained$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^handoffd and babysitterd for root R are still down$/, (ctx) => {
    const output = runMainSuite(ctx);
    expectLine(output, 'ok   - 03: deliberate stop marker present', '03-down');
  });

  scoped(/^nothing has invoked start-swarm\.sh for root R$/, (ctx) => {
    const output = runMainSuite(ctx);
    expectLine(output, 'ok   - 03: schedule scripts did not fire', '03-no-start');
    expectLine(
      output,
      'PASS: 03: deliberate stop survives freshness and schedule cron ticks',
      '03',
    );
  });

  scoped(/^the user crontab has swarmforge lines for roots R1 and R2$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^the operator runs stop-swarm\.sh for root R1$/, (ctx) => {
    runMainSuite(ctx);
  });

  scoped(/^crontab -l still contains every swarmforge line scoped to root R2$/, (ctx) => {
    const output = runMainSuite(ctx);
    expectLine(output, 'ok   - 04: R2 freshness remains', '04-r2');
    expectLine(output, 'ok   - 04: R2 schedule remains', '04-r2-sched');
  });

  scoped(/^crontab -l contains no swarmforge line scoped to root R1$/, (ctx) => {
    const output = runMainSuite(ctx);
    expectLine(output, 'ok   - 04: R1 lines gone', '04-r1');
    expectLine(
      output,
      'PASS: 04: stop-swarm for one root leaves sibling root cron lines unchanged',
      '04',
    );
    expectLine(output, 'BL-1162 start-stop-swarm-cron-lifecycle: ALL CHECKS PASSED', 'suite');
  });
}

module.exports = { registerSteps };
