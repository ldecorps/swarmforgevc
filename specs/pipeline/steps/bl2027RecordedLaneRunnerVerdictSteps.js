'use strict';

// BL-2027: step handlers for "The recorded lane runner names every red and
// runs a bounded prefix". Drives the REAL run_recorded_lane.sh against
// fixture lists under mkdtemp (trackedTmpRoot, BL-1390) - never a
// reimplementation of the runner. Scenarios 04 (two rows) and 05.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const RUNNER = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'test', 'run_recorded_lane.sh');

const FEATURE = 'BL-2027 The recorded lane runner names every red and runs a bounded prefix';

const KNOWN_SHAPES = {
  'both pass': ['a\ttrue', 'b\ttrue'],
  'include one that fails': ['a\ttrue', 'b\tfalse'],
  'the first one fails': ['a\tfalse', 'b\ttrue'],
  'the first one reads stdin and the second fails': ['a\tread -r x; echo "a read: $x" >&2', 'b\tfalse'],
};

function knownShapeLines(text) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_SHAPES, text)) {
    throw new Error(`BL-2027: unrecognized <shape> example value "${text}"`);
  }
  return KNOWN_SHAPES[text];
}

const KNOWN_EXITS = { '0': 0, '1': 1 };

function knownExit(text) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_EXITS, text)) {
    throw new Error(`BL-2027: unrecognized <exit> example value "${text}"`);
  }
  return KNOWN_EXITS[text];
}

const KNOWN_NAMES = {
  'names no failing item': 0,
  'names exactly that item': 1,
  'names exactly the first item': 1,
  'names exactly the second item': 1,
};

function knownFailedLineCount(text) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_NAMES, text)) {
    throw new Error(`BL-2027: unrecognized <names> example value "${text}"`);
  }
  return KNOWN_NAMES[text];
}

function runRunner(ctx, listPath, durPath, limit, env) {
  const args = ['bash', RUNNER, '--lane', 'fixture', '--list', listPath, '--durations', durPath];
  if (limit !== undefined) {
    args.push('--limit', String(limit));
  }
  const res = spawnSync(args[0], args.slice(1), { encoding: 'utf8', env: env || process.env });
  ctx.bl2027 = { status: res.status, stdout: res.stdout, listPath, durPath };
}

// Scenario 06: a fake `date` on PATH that prints %3N literally, as BSD
// date on macOS does - <seconds>3N when an argument contains %3N, the
// real date (resolved by absolute path before PATH changes) otherwise.
function writeBsdStyleDate(dir) {
  const realDate = spawnSync('bash', ['-lc', 'command -v date'], { encoding: 'utf8' }).stdout.trim();
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const fake = path.join(binDir, 'date');
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash\n` +
      `for a in "$@"; do\n` +
      `  case "$a" in *%3N*)\n` +
      `    printf '%s3N\\n' "$(${JSON.stringify(realDate)} +%s)"\n` +
      `    exit 0\n` +
      `    ;;\n` +
      `  esac\n` +
      `done\n` +
      `exec ${JSON.stringify(realDate)} "$@"\n`,
    { mode: 0o755 }
  );
  return binDir;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── recorded-lane-runner-04 ───────────────────────────────────────────
  scoped(/^a fixture list whose two items (.+)$/, (ctx, shapeText) => {
    const dir = trackedTmpRoot('sfvc-bl2027-');
    const listPath = path.join(dir, 'list.tsv');
    const durPath = path.join(dir, 'durations.jsonl');
    fs.writeFileSync(listPath, knownShapeLines(shapeText).join('\n') + '\n');
    ctx.bl2027 = { dir, listPath, durPath };
  });

  scoped(/^the recorded lane runner runs that list to the end$/, (ctx) => {
    const { listPath, durPath, env } = ctx.bl2027;
    runRunner(ctx, listPath, durPath, undefined, env);
  });

  scoped(/^it exits (.+)$/, (ctx, exitText) => {
    assert.equal(ctx.bl2027.status, knownExit(exitText));
  });

  scoped(/^its verdict (.+)$/, (ctx, namesText) => {
    const failedLines = ctx.bl2027.stdout.split('\n').filter((line) => line.startsWith('FAILED '));
    assert.equal(failedLines.length, knownFailedLineCount(namesText));
    for (const line of failedLines) {
      if (namesText === 'names exactly the first item') {
        assert.equal(line, 'FAILED a');
      } else if (namesText === 'names exactly the second item') {
        assert.equal(line, 'FAILED b');
      } else {
        assert.equal(line, 'FAILED b');
      }
    }
  });

  // ── recorded-lane-runner-05 ───────────────────────────────────────────
  scoped(/^a fixture list whose two items both pass$/, (ctx) => {
    const dir = trackedTmpRoot('sfvc-bl2027-');
    const listPath = path.join(dir, 'list.tsv');
    const durPath = path.join(dir, 'durations.jsonl');
    fs.writeFileSync(listPath, KNOWN_SHAPES['both pass'].join('\n') + '\n');
    ctx.bl2027 = { dir, listPath, durPath };
  });

  scoped(/^the recorded lane runner runs that list with a limit of 1$/, (ctx) => {
    const { listPath, durPath } = ctx.bl2027;
    runRunner(ctx, listPath, durPath, 1);
  });

  scoped(/^it runs exactly the first item$/, (ctx) => {
    const rows = fs.readFileSync(ctx.bl2027.durPath, 'utf8').split('\n').filter((line) => line.length > 0);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].includes('"file":"a"'), `expected the single row to name item a, got: ${rows[0]}`);
  });

  scoped(/^the durations file holds exactly one row$/, (ctx) => {
    const rows = fs.readFileSync(ctx.bl2027.durPath, 'utf8').split('\n').filter((line) => line.length > 0);
    assert.equal(rows.length, 1);
  });

  // ── recorded-lane-runner-06 ───────────────────────────────────────────
  scoped(/^a date on PATH that prints %3N literally, as BSD date does$/, (ctx) => {
    const binDir = writeBsdStyleDate(ctx.bl2027.dir);
    ctx.bl2027.env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
  });

  scoped(/^every row's duration_ms is a whole number of milliseconds$/, (ctx) => {
    const rows = fs.readFileSync(ctx.bl2027.durPath, 'utf8').split('\n').filter((line) => line.length > 0);
    assert.ok(rows.length > 0, 'expected at least one duration row');
    for (const line of rows) {
      const row = JSON.parse(line);
      assert.ok(Number.isInteger(row.duration_ms) && row.duration_ms >= 0,
        `expected a whole non-negative duration_ms, got: ${line}`);
    }
  });
}

module.exports = { registerSteps };
