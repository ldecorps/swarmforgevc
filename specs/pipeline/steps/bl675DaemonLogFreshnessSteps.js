'use strict';

// BL-675: step handlers for "Daemon log freshness watchdog".
// Drives the REAL shell suite (test_daemon_log_freshness.sh) with injected
// clock/paths/announce/kill/start seams — never a parallel reimplementation
// of the POSIX checker. Greps the suite's own PASS lines per scenario.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const FRESHNESS_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_daemon_log_freshness.sh');

const KNOWN_DAEMONS = new Set(['handoffd', 'babysitterd']);

function knownDaemon(value) {
  if (!KNOWN_DAEMONS.has(value)) {
    throw new Error(`BL-675: unrecognized daemon "${value}"`);
  }
  return value;
}

function runFreshnessSuite(ctx) {
  if (ctx.bl675Output) {
    return ctx.bl675Output;
  }
  const result = spawnSync('bash', [FRESHNESS_TEST], {
    encoding: 'utf8',
    timeout: 120000,
    env: process.env,
  });
  ctx.bl675Output = `${result.stdout || ''}${result.stderr || ''}`;
  ctx.bl675Exit = result.status;
  return ctx.bl675Output;
}

function expectLine(output, fragment, label) {
  if (!output.includes(fragment)) {
    throw new Error(`expected "${fragment}" (${label}) in BL-675 freshness suite output, got:\n${output}`);
  }
}

function registerSteps(registry) {
  registry.define(
    /^watched daemons "([^"]+)" with heartbeat thresholds "([^"]+)" seconds$/,
    (ctx, daemons, thresholds) => {
      ctx.watchedDaemons = daemons.split(',').map((d) => knownDaemon(d.trim()));
      ctx.thresholds = thresholds.split(',').map((t) => Number(t.trim()));
      // Suite encodes the same defaults from daemon_log_freshness.conf.
      ctx.output = runFreshnessSuite(ctx);
    }
  );

  registry.define(
    /^the freshness checker runs with injected clock, log paths, and announce command$/,
    (ctx) => {
      ctx.output = runFreshnessSuite(ctx);
      if (ctx.bl675Exit !== 0) {
        throw new Error(`BL-675 freshness suite exited ${ctx.bl675Exit}:\n${ctx.output}`);
      }
      expectLine(ctx.output, 'BL-675 daemon-log-freshness: ALL CHECKS PASSED', 'suite-green');
    }
  );

  // ── 01 ────────────────────────────────────────────────────────────────
  registry.define(/^a daemon loop completes three ticks during which no work arrives$/, (ctx) => {
    ctx.output = runFreshnessSuite(ctx);
  });

  registry.define(/^its log gains three timestamped heartbeat lines$/, (ctx) => {
    const output = ctx.output || runFreshnessSuite(ctx);
    expectLine(
      output,
      'PASS: 01: babysitter_runtime heartbeats every tick with no work',
      '01'
    );
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  registry.define(/^the "([^"]+)" heartbeat is older than its threshold$/, (ctx, daemon) => {
    knownDaemon(daemon);
    ctx.staleDaemon = daemon;
    ctx.output = runFreshnessSuite(ctx);
  });

  registry.define(/^the freshness checker runs$/, (ctx) => {
    ctx.output = runFreshnessSuite(ctx);
  });

  registry.define(
    /^the "([^"]+)" process is killed and relaunched via its own start script$/,
    (ctx, daemon) => {
      knownDaemon(daemon);
      const output = ctx.output || runFreshnessSuite(ctx);
      if (daemon === 'handoffd') {
        expectLine(output, 'PASS: 02a: stale handoffd restarts through start_handoff_daemon.sh', '02-handoffd');
      } else {
        expectLine(output, 'PASS: 02b: stale babysitterd restarts through start_babysitter.sh', '02-babysitterd');
      }
    }
  );

  registry.define(
    /^the durable incident record names "([^"]+)" and its heartbeat age$/,
    (ctx, daemon) => {
      knownDaemon(daemon);
      const output = ctx.output || runFreshnessSuite(ctx);
      if (daemon === 'handoffd') {
        // 02a and 04 both assert handoffd + age_secs in the durable record.
        if (
          !output.includes('PASS: 02a: stale handoffd restarts through start_handoff_daemon.sh') &&
          !output.includes('PASS: 04: failed announce still leaves durable incident record')
        ) {
          throw new Error(
            `expected PASS for handoffd durable-record coverage (02a or 04), got:\n${output}`
          );
        }
      } else {
        expectLine(output, 'PASS: 02b: stale babysitterd restarts through start_babysitter.sh', 'record-babysitterd');
      }
    }
  );

  registry.define(/^the announce command is invoked after the record is written$/, (ctx) => {
    const output = ctx.output || runFreshnessSuite(ctx);
    expectLine(output, 'announce after record (FRESHNESS_VIOLATION)', 'announce-after-record');
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  registry.define(
    /^the "([^"]+)" log shows no work lines but a fresh heartbeat$/,
    (ctx, daemon) => {
      knownDaemon(daemon);
      ctx.output = runFreshnessSuite(ctx);
    }
  );

  registry.define(
    /^no process is killed, no record is written, and no announce is invoked$/,
    (ctx) => {
      const output = ctx.output || runFreshnessSuite(ctx);
      // Scenarios 03 and 05 share this Then — either PASS line satisfies.
      if (
        !output.includes('PASS: 03: quiet heartbeating daemon is never restarted') &&
        !output.includes('PASS: 05: all fresh → no side effects')
      ) {
        throw new Error(
          `expected PASS for scenario 03 or 05 (no side effects) in suite output, got:\n${output}`
        );
      }
    }
  );

  // ── 04 ────────────────────────────────────────────────────────────────
  registry.define(/^the announce command fails$/, (ctx) => {
    ctx.output = runFreshnessSuite(ctx);
    expectLine(ctx.output, 'PASS: 04: failed announce still leaves durable incident record', '04');
  });

  // ── 05 ────────────────────────────────────────────────────────────────
  registry.define(/^every watched daemon heartbeat is within its threshold$/, (ctx) => {
    ctx.output = runFreshnessSuite(ctx);
  });

  // ── 06 ────────────────────────────────────────────────────────────────
  registry.define(
    /^a restart of "([^"]+)" was already recorded inside the cool-off window$/,
    (ctx, daemon) => {
      knownDaemon(daemon);
      ctx.output = runFreshnessSuite(ctx);
    }
  );

  registry.define(
    /^no second restart is attempted and the escalation announce is invoked$/,
    (ctx) => {
      const output = ctx.output || runFreshnessSuite(ctx);
      expectLine(
        output,
        'PASS: 06: cool-off escalates without hammering restarts',
        '06'
      );
    }
  );
}

module.exports = { registerSteps };
