'use strict';

// BL-2048: step handlers for "The property-runner front-end runs every
// property runner in name order". Drives the REAL
// swarmforge/scripts/test/run_property_runners.sh against a fixture
// directory under mkdtemp (trackedTmpRoot, BL-1390) - never a
// reimplementation of the front-end. Scenario 01.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FRONT_END = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'test', 'run_property_runners.sh');

const FEATURE = 'BL-2048 The property-runner front-end runs every property runner in name order';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── property-runner-front-end-01 ──────────────────────────────────────
  scoped(/^a fixture test directory holding a \.bb, a \.sh and a \.js property runner and one file that is not a property runner$/, (ctx) => {
    const dir = trackedTmpRoot('sfvc-bl2048-');
    const logPath = path.join(dir, 'log.txt');
    const durPath = path.join(dir, 'durations.jsonl');
    // Each runner is valid code only for its own interpreter and appends
    // one line to the log whose path the handler passes in an env var.
    fs.writeFileSync(path.join(dir, 'b_property_runner.bb'),
      '(spit (System/getenv "LOG") "b bb\\n" :append true)\n');
    fs.writeFileSync(path.join(dir, 'a_property_runner.sh'),
      '#!/usr/bin/env bash\necho "a bash" >> "$LOG"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'c_property_runner.js'),
      "require('fs').appendFileSync(process.env.LOG, 'c node\\n');\n");
    // Not a property runner: the front-end must not list it.
    fs.writeFileSync(path.join(dir, 'd_test_runner.bb'),
      '(spit (System/getenv "LOG") "d\\n" :append true)\n');
    ctx.bl2048 = { dir, logPath, durPath };
  });

  scoped(/^the property-runner front-end runs that directory$/, (ctx) => {
    const { dir, logPath, durPath } = ctx.bl2048;
    const res = spawnSync('bash', [FRONT_END, '--durations', durPath, dir], {
      encoding: 'utf8',
      env: { ...process.env, LOG: logPath, TMUX: undefined },
    });
    ctx.bl2048 = { ...ctx.bl2048, status: res.status, stdout: res.stdout };
  });

  scoped(/^it runs exactly the three property runners$/, (ctx) => {
    const lines = fs.readFileSync(ctx.bl2048.logPath, 'utf8').split('\n').filter((l) => l.length > 0);
    assert.deepEqual(lines, ['a bash', 'b bb', 'c node'],
      `expected exactly the three property runners in the log, got: ${JSON.stringify(lines)}`);
  });

  scoped(/^it runs them in name order$/, (ctx) => {
    const lines = fs.readFileSync(ctx.bl2048.logPath, 'utf8').split('\n').filter((l) => l.length > 0);
    assert.deepEqual(lines, ['a bash', 'b bb', 'c node'],
      `expected the runners in name order (a, b, c), got: ${JSON.stringify(lines)}`);
  });

  scoped(/^it runs the \.bb runner with bb, the \.sh runner with bash and the \.js runner with node$/, (ctx) => {
    // A runner started under the wrong interpreter fails before it writes,
    // so a log of exactly "a bash", "b bb", "c node" proves each ran under
    // its own interpreter.
    const lines = fs.readFileSync(ctx.bl2048.logPath, 'utf8').split('\n').filter((l) => l.length > 0);
    assert.deepEqual(lines, ['a bash', 'b bb', 'c node'],
      `expected each runner to run under its own interpreter, got: ${JSON.stringify(lines)}`);
  });

  scoped(/^the durations file holds one row per property runner$/, (ctx) => {
    const rows = fs.readFileSync(ctx.bl2048.durPath, 'utf8').split('\n').filter((l) => l.length > 0);
    assert.equal(rows.length, 3, `expected one duration row per property runner, got ${rows.length}`);
    for (const line of rows) {
      const row = JSON.parse(line);
      assert.equal(row.lane, 'property-runners');
      assert.ok(row.file.endsWith('_property_runner.bb') || row.file.endsWith('_property_runner.sh') || row.file.endsWith('_property_runner.js'),
        `expected a property runner file in the row, got: ${row.file}`);
    }
  });
}

module.exports = { registerSteps };
