'use strict';

// BL-2028: step handlers for "The recorded lane runner appends one duration
// row per completed item and none for an incomplete one". Drives the REAL
// run_recorded_lane.sh against fixture lists under mkdtemp (trackedTmpRoot,
// BL-1390) - never a reimplementation of the runner. Scenario 03 (three rows),
// one of them asynchronous: the killed run.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const RUNNER = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'test', 'run_recorded_lane.sh');

const FEATURE = 'BL-2028 The recorded lane runner appends one duration row per completed item';

const KNOWN_SHAPES = {
  'both pass': ['a\ttrue', 'b\ttrue'],
  'include one that fails': ['a\ttrue', 'b\tfalse'],
};

function knownShapeLines(text) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_SHAPES, text)) {
    throw new Error(`BL-2028: unrecognized <shape> example value "${text}"`);
  }
  return KNOWN_SHAPES[text];
}

const KNOWN_ROWS = {
  'one row per item, both passing': { count: 2, results: ['pass', 'pass'] },
  'one row per item, one failing': { count: 2, results: ['pass', 'fail'] },
  'exactly one row': { count: 1, results: ['pass'], file: 'a' },
};

function knownRows(text) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_ROWS, text)) {
    throw new Error(`BL-2028: unrecognized <rows> example value "${text}"`);
  }
  return KNOWN_ROWS[text];
}

function readRows(durPath) {
  if (!fs.existsSync(durPath)) {
    return [];
  }
  return fs.readFileSync(durPath, 'utf8').split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── recorded-lane-runner-03 ───────────────────────────────────────────
  scoped(/^a fixture list whose two items (.+)$/, (ctx, shapeText) => {
    const dir = trackedTmpRoot('sfvc-bl2028-');
    const listPath = path.join(dir, 'list.tsv');
    const durPath = path.join(dir, 'durations.jsonl');
    fs.writeFileSync(listPath, knownShapeLines(shapeText).join('\n') + '\n');
    ctx.bl2028 = { dir, listPath, durPath };
  });

  scoped(/^the recorded lane runner runs that list to the end$/, (ctx) => {
    const { listPath, durPath } = ctx.bl2028;
    const res = spawnSync('bash', [RUNNER, '--lane', 'fixture', '--list', listPath, '--durations', durPath],
      { encoding: 'utf8' });
    ctx.bl2028 = { ...ctx.bl2028, status: res.status, stdout: res.stdout };
  });

  scoped(/^the recorded lane runner is killed after the first$/, async (ctx) => {
    const { dir, durPath } = ctx.bl2028;
    // Item b sleeps 5 s so the runner is still inside item b when it is
    // killed; item a keeps its shape's command.
    const listPath = path.join(dir, 'list.tsv');
    fs.writeFileSync(listPath, 'a\ttrue\nb\tsleep 5\n');
    const child = spawn('bash', [RUNNER, '--lane', 'fixture', '--list', listPath, '--durations', durPath],
      { stdio: 'ignore' });
    const deadline = Date.now() + 10000;
    while (readRows(durPath).length < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
  });

  scoped(/^the durations file holds (.+)$/, (ctx, rowsText) => {
    const expected = knownRows(rowsText);
    const rows = readRows(ctx.bl2028.durPath);
    assert.equal(rows.length, expected.count,
      `expected ${expected.count} row(s), got ${rows.length}: ${JSON.stringify(rows)}`);
    rows.forEach((row, i) => {
      assert.equal(row.result, expected.results[i],
        `row ${i + 1}: expected result "${expected.results[i]}", got "${row.result}"`);
    });
    if (expected.file !== undefined) {
      assert.equal(rows[0].file, expected.file,
        `expected the single row to name item ${expected.file}, got: ${JSON.stringify(rows[0])}`);
    }
  });
}

module.exports = { registerSteps };
